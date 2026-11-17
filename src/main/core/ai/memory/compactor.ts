
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Knex } from 'knex';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { log } from '../../system/log';
import { estimateMessagesTokens, estimateTextTokens } from './tokenEstimator';
import { aiContentToText } from '../../../../shared/ai/aiImages';
import {
  applyCompression,
  getHotState,
  rebuildHotState,
  type TrackedMessage,
} from "./hotMemory";

const CONTEXT_WINDOW_TOKENS = 200_000;

const TRIGGER_RATIO = 0.30;

const WATERMARK_RATIO = 0.18;

const THRESHOLD_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * TRIGGER_RATIO);

const WATERMARK_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * WATERMARK_RATIO);

const KEEP_RECENT_MESSAGES = 12;

const MIN_RECENT_MESSAGES = 4;

const MAX_ROUNDS = 3;

const ROUND_TOKEN_BUDGET = 12_000;

const SUMMARY_TARGET_CHARS = 400;

const COMPRESS_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个对话摘要器。把给定的对话片段压缩成一段简明的摘要，规则：

1. 保留关键信息：结论、决定、事实数据、待办事项、用户明确表达的偏好
2. 保留未解决的问题和悬而未决的选项
3. 丢弃寒暄、重复、过程性的中间讨论
4. 用中文输出，不加标题不加前言，直接写摘要正文
5. 长度控制在 ${SUMMARY_TARGET_CHARS} 字以内
{truncationNotice}`,
  ],
  ['human', '{conversation}'],
]);

export interface CompactProgress {
  phase: 'compressing' | 'done';
  round?: number;
  maxRounds?: number;
  tokens?: number;
}

export type CompactStopReason =
  | 'watermark'
  | 'floor-unreachable'
  | 'too-few-messages'
  | 'rounds-exhausted';

export interface CompressResult {
  compressed: boolean;
  rounds: number;
  messageCountBefore: number;
  messageCountAfter: number;
  stoppedBy?: CompactStopReason;
  truncatedRounds?: number;
  omittedChars?: number;
  reason?: string;
}

function toEstimable(t: TrackedMessage): { role: string; content: string } {
  return {
    role: t.message.getType(),
    content: aiContentToText(t.message.content),
  };
}

function watermarkUnreachable(
  state: { summary: string[]; messages: TrackedMessage[] },
  keepTarget: number
): boolean {
  const floorTokens =
    state.summary.reduce((sum, s) => sum + estimateTextTokens(s), 0) +
    estimateMessagesTokens(state.messages.slice(-keepTarget).map(toEstimable));
  return floorTokens >= WATERMARK_TOKENS;
}

function contentOf(t: TrackedMessage): string {
  return aiContentToText(t.message.content);
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const total = estimateTextTokens(text);
  if (total <= maxTokens || text.length < 2) return text;

  const keepChars = Math.max(2, Math.floor(text.length * (maxTokens / total)));
  const headChars = Math.floor(keepChars * 0.6);
  const tailChars = keepChars - headChars;
  const omitted = text.length - headChars - tailChars;
  return (
    text.slice(0, headChars) +
    `\n…（本条消息过长，此处省略中段 ${omitted} 字）…\n` +
    text.slice(text.length - tailChars)
  );
}

interface PickedBatch {
  batch: TrackedMessage[];
  fullChars: number;
  truncatedCount: number;
  omittedChars: number;
}

function pickBatch(messages: TrackedMessage[], maxCount: number): PickedBatch {
  const batch: TrackedMessage[] = [];
  let used = 0;
  let fullChars = 0;
  let truncatedCount = 0;
  let omittedChars = 0;

  for (const t of messages) {
    if (batch.length >= maxCount) break;

    const content = contentOf(t);
    const textTokens = estimateTextTokens(content);
    fullChars += content.length;

    if (batch.length > 0 && used + textTokens > ROUND_TOKEN_BUDGET) break;

    if (textTokens > ROUND_TOKEN_BUDGET) {
      const trimmed = truncateToTokenBudget(content, ROUND_TOKEN_BUDGET);
      truncatedCount += 1;
      omittedChars += content.length - trimmed.length;
      used += estimateTextTokens(trimmed);
    } else {
      used += textTokens;
    }

    batch.push(t);
  }

  return { batch, fullChars, truncatedCount, omittedChars };
}

function messagesToText(messages: TrackedMessage[]): string {
  const roleLabel: Record<string, string> = {
    human: '用户',
    ai: '助手',
    system: '系统',
  };
  return messages
    .map((t) => {
      const label = roleLabel[t.message.getType()] ?? t.message.getType();
      return `${label}：${truncateToTokenBudget(contentOf(t), ROUND_TOKEN_BUDGET)}`;
    })
    .join('\n\n');
}

function buildTruncationNotice(p: {
  truncatedCount: number;
  omittedChars: number;
  fullChars: number;
}): string {
  if (p.truncatedCount === 0) return '';

  const lostPct = p.fullChars > 0 ? Math.round((p.omittedChars / p.fullChars) * 100) : 0;
  return `

【重要】本批对话中有 ${p.truncatedCount} 条消息过长，只提供了头尾节选，
省略了合计约 ${p.omittedChars} 字（占本批原文 ${lostPct}%）的中段内容。
- 只依据你实际看到的内容总结，不要推测节选中被省略的部分
- 摘要末尾必须以「（本段基于节选生成，部分内容已省略）」开头`;
}

function estimateStateTokens(state: {
  summary: string[];
  messages: TrackedMessage[];
}): number {
  const summaryTokens = state.summary.reduce(
    (sum, s) => sum + estimateTextTokens(s),
    0
  );
  const messageTokens = estimateMessagesTokens(state.messages.map(toEstimable));
  return summaryTokens + messageTokens;
}

export async function compactIfNeeded(
  DB: Knex,
  sessionId: string,
  model: BaseChatModel,
  onProgress?: (p: CompactProgress) => void
): Promise<CompressResult> {
  let state = await getHotState(DB, sessionId);
  const messageCountBefore = state.messages.length;

  const initialTokens = estimateStateTokens(state);
  if (initialTokens <= THRESHOLD_TOKENS) {
    return {
      compressed: false,
      rounds: 0,
      messageCountBefore,
      messageCountAfter: state.messages.length,
      reason: `under threshold (${initialTokens} <= ${THRESHOLD_TOKENS})`,
    };
  }

  log.info(
    `[compact] session ${sessionId} over threshold`,
    { tokens: initialTokens, messages: state.messages.length }
  );

  onProgress?.({ phase: 'compressing', maxRounds: MAX_ROUNDS, tokens: initialTokens });

  let rounds = 0;
  let stoppedBy: CompactStopReason = 'rounds-exhausted';
  let truncatedRounds = 0;
  let omittedChars = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    state = await getHotState(DB, sessionId);
    const currentTokens = estimateStateTokens(state);

    if (currentTokens <= WATERMARK_TOKENS) {
      stoppedBy = 'watermark';
      break;
    }

    const keepTarget = Math.min(
      KEEP_RECENT_MESSAGES,
      Math.max(MIN_RECENT_MESSAGES, state.messages.length - 1)
    );
    const compressibleCount = state.messages.length - keepTarget;

    if (compressibleCount <= 0) {
      log.info(`[compact] session ${sessionId} too few messages to compress`, {
        messages: state.messages.length,
        keepTarget,
      });
      stoppedBy = 'too-few-messages';
      break;
    }

    const picked = pickBatch(state.messages, compressibleCount);
    const batch = picked.batch;

    const firstId = batch[0].id;
    const lastId = batch[batch.length - 1].id;

    if (firstId < 0 || lastId < 0) {
      log.warn(`[compact] session ${sessionId} missing message ids, rebuilding cache`);
      state = await rebuildHotState(DB, sessionId);
      continue;
    }

    let summaryText: string;
    try {
      const promptValue = await COMPRESS_PROMPT.formatMessages({
        conversation: messagesToText(batch),
        truncationNotice: buildTruncationNotice(picked),
      });
      const result = await model.invoke(promptValue);

      summaryText =
        typeof result.content === 'string'
          ? result.content
          : Array.isArray(result.content)
            ? result.content
                .map((c: any) => (typeof c === 'string' ? c : c?.text ?? ''))
                .join('')
            : '';
      summaryText = summaryText.trim();
    } catch (err) {
      log.error(`[compact] session ${sessionId} LLM call failed`, err);
      break;
    }

    if (!summaryText) {
      log.warn(`[compact] session ${sessionId} empty summary, abort`);
      break;
    }

    const batchChars = batch.reduce(
      (sum, t) => sum + aiContentToText(t.message.content).length,
      0
    );

    await DB('ai_chat_summary').insert({
      session_id: sessionId,
      from_message_id: firstId,
      to_message_id: lastId,
      summary: summaryText,
      compressed_count: batch.length,
      compressed_chars: batchChars,
      created_at: new Date(),
    });

    await DB('ai_chat')
      .where('session_id', sessionId)
      .whereBetween('id', [firstId, lastId])
      .update({ compressed: 1 });

    applyCompression(sessionId, summaryText, batch.length);
    rounds += 1;
    if (picked.truncatedCount > 0) {
      truncatedRounds += 1;
      omittedChars += picked.omittedChars;
    }

    log.info(`[compact] session ${sessionId} round ${round + 1} done`, {
      compressed: batch.length,
      batchChars: picked.fullChars,
      ratio: `${Math.round(picked.fullChars / Math.max(1, summaryText.length))}:1`,
      messagesLeft: state.messages.length - batch.length,
      summaryChars: summaryText.length,
    });

    if (picked.truncatedCount > 0) {
      log.warn(
        `[compact] session ${sessionId} round ${round + 1}: ${picked.truncatedCount} 条超长消息被截断，` +
          `${picked.omittedChars} 字未进入摘要（占本批 ${Math.round(
            (picked.omittedChars / Math.max(1, picked.fullChars)) * 100
          )}%）`
      );
    }

    onProgress?.({ phase: 'compressing', round: rounds, maxRounds: MAX_ROUNDS, tokens: currentTokens });

    if (watermarkUnreachable(state, keepTarget)) {
      log.info(`[compact] session ${sessionId} watermark unreachable, stop after round ${rounds}`, {
        messagesLeft: state.messages.length,
        keepTarget,
      });
      stoppedBy = 'floor-unreachable';
      break;
    }
  }

  const finalState = await rebuildHotState(DB, sessionId);

  onProgress?.({ phase: 'done', round: rounds, maxRounds: MAX_ROUNDS });

  return {
    compressed: rounds > 0,
    rounds,
    messageCountBefore,
    messageCountAfter: finalState.messages.length,
    stoppedBy,
    truncatedRounds,
    omittedChars,
  };
}

export const COMPACT_CONFIG = {
  CONTEXT_WINDOW_TOKENS,
  TRIGGER_RATIO,
  WATERMARK_RATIO,
  THRESHOLD_TOKENS,
  WATERMARK_TOKENS,
  KEEP_RECENT_MESSAGES,
  MIN_RECENT_MESSAGES,
  MAX_ROUNDS,
  ROUND_TOKEN_BUDGET,
  SUMMARY_TARGET_CHARS,
} as const;
