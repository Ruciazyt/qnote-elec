/**
 * 会话热内存 — 按 sessionId 缓存「摘要 + 未压缩的原始消息」
 *
 * 设计取舍（与「临时文件 + 空闲写回」方案的差异）：
 *   - 写 DB 仍然是一轮一次同步 insert（无状态、崩溃不丢数据）
 *   - 内存里只放**只读热副本**，用于组装 prompt，避免每轮一次 SQL
 *   - 内存缓存可随时丢弃：丢了就从 DB 重建，不影响正确性
 *
 * 内存结构：
 *   sessionId → {
 *     summary:   string[]          // 该会话的压缩摘要（按时间正序）
 *     messages:  BaseMessage[]     // 未被压缩的原始消息（按时间正序）
 *   }
 *
 * 一致性保证：
 *   - appendMessages 写入内存 + 落 DB 由调用方负责（handler 里已经做了 DB 写）
 *   - 缓存与 DB 不一致时，invalidate(sessionId) 强制下次重建
 *   - 进程重启后缓存为空，从 DB 重建（summary 从 ai_chat_summary 表读）
 */

import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import type { Knex } from 'knex';
import { log } from '../../log';
import {
  aiContentToText,
  buildUserContent,
  parseAiImages,
  type AiImageAttachment,
} from '../../../../shared/aiImages';

/** 会话热状态（摘要 + 未压缩的原始消息） */
export interface SessionHotState {
  /** 压缩摘要（多阶段，按时间正序） */
  summary: string[];
  /** 未压缩的原始消息（按时间正序，带 DB id） */
  messages: TrackedMessage[];
  /** 最后一次从 DB 重建的时间戳（用于调试） */
  loadedAt: number;
}

/**
 * 带 DB id 的消息
 * 压缩时需要 id 范围来安全删除原始行（LangChain Message 本身不带 id）
 */
export interface TrackedMessage {
  /** ai_chat.id */
  id: number;
  message: BaseMessage;
}

/** 全局缓存表。进程内单例，不需要跨 worker 共享 */
const cache = new Map<string, SessionHotState>();

/**
 * DB 行 → LangChain Message
 *
 * 带图的 user 行会被还原成「文本块 + 图片块」的 content 数组 ——
 * 模型在后续轮次里要能重新看到这张图，否则「图里第二行写的什么」
 * 这类追问会答不上来。
 */
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

/**
 * 获取会话的热状态（如果没有则从 DB 重建）
 */
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

/**
 * 强制从 DB 重建缓存（压缩后 / 删消息后 / 检测到不一致时调用）
 */
export async function rebuildHotState(
  DB: Knex,
  sessionId: string
): Promise<SessionHotState> {
  const [summaryRows, messageRows] = await Promise.all([
    DB('ai_chat_summary')
      .select('summary')
      .where('session_id', sessionId)
      .orderBy('id', 'asc'),
    // 软删除：只读未压缩的（compressed=0）
    // 已压缩的原始消息仍留在 ai_chat 表里给前端历史列表用，但不进 prompt
    // images 必须一起选：带图的用户消息要还原成多模态 content 才能被模型看见
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

/**
 * 追加新消息到热状态
 *
 * 注意：调用方负责同时写 DB（handler 里的 persistAiChatExchange 已经做了）。
 * 这里只更新内存，避免重复 IO。
 */
export function appendToHotState(
  sessionId: string,
  messages: BaseMessage[],
  dbIds: number[] = []
): void {
  const state = cache.get(sessionId);
  if (!state) {
    // 缓存还没建立（说明本次请求没走过 getHotState）—— 下次会重建，不急
    return;
  }
  messages.forEach((message, i) => {
    state.messages.push({
      // 写库时拿到的 id；没传就填 -1（压缩时会跳过这批，触发安全回退）
      id: typeof dbIds[i] === 'number' ? dbIds[i] : -1,
      message,
    });
  });
}

/**
 * 压缩完成后更新热状态
 * 把被压缩掉的原始消息从内存移除，追加新的摘要
 */
export function applyCompression(
  sessionId: string,
  newSummary: string,
  compressedCount: number
): void {
  const state = cache.get(sessionId);
  if (!state) return;

  // 从头部移除被压缩的消息（压缩的总是最早的那批）
  state.messages.splice(0, compressedCount);
  state.summary.push(newSummary);
}

/**
 * 让缓存失效（删除会话 / 清空对话 / 压缩失败回滚后调用）
 * 下次访问会从 DB 全量重建
 */
export function invalidateHotState(sessionId?: string): void {
  if (sessionId) {
    cache.delete(sessionId);
    log.info(`[hot-memory] invalidated session ${sessionId}`);
  } else {
    cache.clear();
    log.info(`[hot-memory] invalidated all sessions`);
  }
}

/**
 * 缓存统计（调试用）
 */
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

/**
 * 组装给 prompt 用的历史：
 *   [摘要 1] [摘要 2] ... [原始消息 1] [原始消息 2] ...
 *
 * 摘要会包成一条 system message，原始消息保持原 role。
 */
export function composeHistory(state: SessionHotState): BaseMessage[] {
  const result: BaseMessage[] = [];

  // 多阶段摘要合并成一条，避免 system 消息过多干扰模型
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
