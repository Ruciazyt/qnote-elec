
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import type { Knex } from 'knex';
import { log } from "../../system/log";
import {
  buildUserContent,
  parseAiImages,
} from '../../../../shared/ai/aiImages';

export interface SessionHotState {
  summary: string[];
  messages: TrackedMessage[];
  loadedAt: number;
}

export interface TrackedMessage {
  id: number;
  message: BaseMessage;
}

const cache = new Map<string, SessionHotState>();

function rowToMessage(row: { role: string; content: string; images?: string }): BaseMessage {
  switch (row.role) {
    case 'assistant':
      return new AIMessage(row.content);
    case 'system':
      return new SystemMessage(row.content);
    default: {
      const images = parseAiImages(row.images);
      if (images.length === 0) return new HumanMessage(row.content);
      return new HumanMessage({ content: buildUserContent(row.content, images) });
    }
  }
}

export async function getHotState(
  DB: Knex,
  sessionId: string
): Promise<SessionHotState> {
  const cached = cache.get(sessionId);
  if (cached) {
    return cached;
  }
  return rebuildHotState(DB, sessionId);
}

export async function rebuildHotState(
  DB: Knex,
  sessionId: string
): Promise<SessionHotState> {
  const [summaryRows, messageRows] = await Promise.all([
    DB('ai_chat_summary')
      .select('summary')
      .where('session_id', sessionId)
      .orderBy('id', 'asc'),
    DB('ai_chat')
      .select('id', 'role', 'content', 'images')
      .where('session_id', sessionId)
      .where('compressed', 0)
      .orderBy('id', 'asc'),
  ]);

  const state: SessionHotState = {
    summary: summaryRows.map((r: any) => r.summary as string).filter(Boolean),
    messages: messageRows.map((r: any) => ({
      id: Number(r.id),
      message: rowToMessage(r),
    })),
    loadedAt: Date.now(),
  };

  cache.set(sessionId, state);
  log.info(`[hot-memory] rebuilt session ${sessionId}`, {
    summaries: state.summary.length,
    messages: state.messages.length,
  });
  return state;
}

export function appendToHotState(
  sessionId: string,
  messages: BaseMessage[],
  dbIds: number[] = []
): void {
  const state = cache.get(sessionId);
  if (!state) {
    return;
  }
  messages.forEach((message, i) => {
    state.messages.push({
      id: typeof dbIds[i] === 'number' ? dbIds[i] : -1,
      message,
    });
  });
}

export function applyCompression(
  sessionId: string,
  newSummary: string,
  compressedCount: number
): void {
  const state = cache.get(sessionId);
  if (!state) return;

  state.messages.splice(0, compressedCount);
  state.summary.push(newSummary);
}

export function invalidateHotState(sessionId?: string): void {
  if (sessionId) {
    cache.delete(sessionId);
    log.info(`[hot-memory] invalidated session ${sessionId}`);
  } else {
    cache.clear();
    log.info(`[hot-memory] invalidated all sessions`);
  }
}

export function getHotStateStats(): {
  sessions: number;
  totalMessages: number;
  totalSummaries: number;
} {
  let totalMessages = 0;
  let totalSummaries = 0;
  for (const state of cache.values()) {
    totalMessages += state.messages.length;
    totalSummaries += state.summary.length;
  }
  return { sessions: cache.size, totalMessages, totalSummaries };
}

export function composeHistory(state: SessionHotState): BaseMessage[] {
  const result: BaseMessage[] = [];

  if (state.summary.length > 0) {
    const combined =
      state.summary.length === 1
        ? state.summary[0]
        : `【会话历史摘要】\n${state.summary
            .map((s, i) => `阶段 ${i + 1}：${s}`)
            .join('\n')}`;
    result.push(new SystemMessage(combined));
  }

  result.push(...state.messages.map((t) => t.message));
  return result;
}
