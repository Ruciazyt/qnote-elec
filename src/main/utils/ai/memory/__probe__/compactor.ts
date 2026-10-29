/**
 * 会话压缩 — 超过阈值时把最早的原始消息交给 LLM 总结成一段话
 *
 * 触发时机：组装 prompt 前，先看「摘要 + 原始消息」的总 token 估算值。
 *   超过 THRESHOLD（窗口的 TRIGGER_RATIO）→ 找出最早的若干条原始消息
 *   → 调 LLM 压缩 → 写 ai_chat_summary
 *   → 软删除那些原始消息（已进摘要，不再进 prompt）
 *   → 重复直到降到 WATERMARK 以下，或水位已经够不着（见下）
 *
 * 三种提前收手，都是为了少等一次 LLM：
 *   - 降到水位           → 正常完成
 *   - 只留最近几条也够不到水位 → 压无可压，做完当前轮就停（floor-unreachable）
 *   - 只剩保底消息条数   → 无从下手，直接停（too-few-messages）
 *
 * 不做什么：
 *   - 不压缩 system prompt（AGENT_SYSTEM_PROMPT 每次都重新拼，不占历史预算）
 *   - 不动最近 KEEP_RECENT 条消息（保证「刚刚聊的」细节不丢）
 *   - 压缩失败时保持原样（宁可 context 长一点，也不要丢历史）
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Knex } from 'knex';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { log } from '../../log';
import { estimateMessagesTokens, estimateTextTokens } from './tokenEstimator';
import { aiContentToText } from '../../../../shared/aiImages';
import {
  applyCompression,
  getHotState,
  rebuildHotState,
  type TrackedMessage,
} from './hotMemory';

/**
 * 模型上下文窗口（token）
 *
 * 之前阈值是写死的 4000 token，与模型真实能力完全脱钩 ——
 * 对 200K 上下文的模型来说，那等于「用到 2% 就开始压缩」，
 * 用户还没感觉到对话变长，历史就已经被摘要掉了。
 *
 * 这里的值决定「什么时候该动手」。取 200_000 是保守估计：
 * MiniMax-M3 / Claude 3.5 / GPT-4o 这一档都在 128K~1M 之间，
 * 按 200K 算意味着实际占用最多到窗口的一半，留足余量给
 * 工具结果、记忆注入和模型自己的输出。
 */
const CONTEXT_WINDOW_TOKENS = 200_000;

/**
 * 触发压缩的占比
 *
 * 取 0.30 而不是更高：要给「工具结果 + 记忆段 + 本轮输出」留出空间。
 * 浏览器快照一次就能带来几千 token，Agent 模式下更甚。
 */
const TRIGGER_RATIO = 0.30;

/**
 * 压缩到水位的占比
 *
 * 压到触发线的 60%（0.18），留出缓冲避免下次请求立刻又触发。
 */
const WATERMARK_RATIO = 0.18;

/** 触发压缩的 token 阈值（由上下文窗口推导） */
const THRESHOLD_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * TRIGGER_RATIO);

/** 压缩后降到这个水位才停 */
const WATERMARK_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * WATERMARK_RATIO);

/** 保留最近这么多条原始消息不压缩（保证近期细节不丢） */
const KEEP_RECENT_MESSAGES = 12;

/**
 * 保底保留条数
 *
 * KEEP_RECENT 是「尽量保留」，这是「必须保留」——
 * 只有当消息条数本身少到 12 条都占满上下文（每条都是大段网页快照 / 长代码）
 * 时才让位，否则 8 条巨长消息永远压在阈值之上、一次都压不动。
 */
const MIN_RECENT_MESSAGES = 4;

/** 单次请求最多压缩几轮 */
const MAX_ROUNDS = 3;

/**
 * 单轮压缩的文本预算（token）
 *
 * 这是**装批依据**，不是截断阈值。摘要输出固定 400 字，所以每轮喂进去的量
 * 直接决定压缩比：
 *   12000 token → 400 字 ≈ 10:1，一份摘要能覆盖的内容还算完整
 *   28000 token → 400 字 ≈ 70:1，再多喂也是在稀释同一份摘要
 *
 * 所以宁可多压几轮（每轮 3 次上限），也不要一轮猛塞 —— ai_chat_summary
 * 本来就是每轮插一行不覆盖，composeHistory 会把多份摘要合并成
 * 「阶段 1 / 阶段 2 / …」，多轮的累积覆盖率远高于一轮包干。
 *
 * 容量校验：3 轮 × 12000 = 36000 token，而触发线 60000 → 水位 36000
 * 只需要处理 24000，够用且留有余量。
 */
const ROUND_TOKEN_BUDGET = 12_000;

/** 摘要目标长度（字符） */
const SUMMARY_TARGET_CHARS = 400;

/** 压缩用的 prompt */
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

/**
 * 压缩进度回调
 *
 * 为什么需要：压缩是「同步阻塞 + 额外调一次 LLM」的，耗时可观
 * （实测单轮可达数秒）。不给用户任何反馈，表现就是界面卡住，
 * 用户分不清是模型在思考还是应用在压缩 —— 后者尤其让人不安，
 * 因为它意味着应用正在悄悄丢弃对话历史。
 */
export interface CompactProgress {
  phase: 'compressing' | 'done';
  /** 已完成轮次 */
  round?: number;
  /** 总轮次上限 */
  maxRounds?: number;
  /** 触发时估算的 token 数 */
  tokens?: number;
}

/** 压缩循环的退出原因（用于日志与返回值定位） */
export type CompactStopReason =
  | 'watermark' // 降到水位了
  | 'floor-unreachable' // 只留最近几条也降不到水位 —— 再压也是白花 LLM 调用
  | 'too-few-messages' // 只剩保底消息，压无可压
  | 'rounds-exhausted'; // 轮数用完（内容实在太多）

export interface CompressResult {
  compressed: boolean;
  rounds: number;
  messageCountBefore: number;
  messageCountAfter: number;
  stoppedBy?: CompactStopReason;
  /** 发生节选压缩的轮数。> 0 表示有内容在摘要器未看到的情况下永久离开 prompt */
  truncatedRounds?: number;
  /** 节选压缩累计省略的字符数 */
  omittedChars?: number;
  reason?: string;
}

/** TrackedMessage → token 估算需要的最小结构 */
function toEstimable(t: TrackedMessage): { role: string; content: string } {
  return {
    role: t.message.getType(),
    // 带图的消息 content 是块数组，取其中的文本部分 ——
    // 不取的话这条消息会被当成零长度，压缩时整段正文凭空消失
    content: aiContentToText(t.message.content),
  };
}

/**
 * 判断水位是否还够得着
 *
 * 把能压的全压掉、只留最近 keepTarget 条，是这个会话能达到的最小状态。
 * 连这个状态都还在水位之上，说明降是降不下去了 —— 每多压一轮
 * 就多等一次 LLM，用户那边表现为「又卡住了」，而上下文并不会更短。
 */
function watermarkUnreachable(
  state: { summary: string[]; messages: TrackedMessage[] },
  keepTarget: number
): boolean {
  const floorTokens =
    state.summary.reduce((sum, s) => sum + estimateTextTokens(s), 0) +
    estimateMessagesTokens(state.messages.slice(-keepTarget).map(toEstimable));
  return floorTokens >= WATERMARK_TOKENS;
}

/**
 * 取消息正文
 *
 * content 可能是字符串，也可能是带图的块数组 —— 两种都要能取到文本。
 * 图片本身不参与摘要（摘要器只吃文本），但带图那条消息的文字必须进去，
 * 否则「我问的是这张图」这个上下文就丢了。
 */
function contentOf(t: TrackedMessage): string {
  return aiContentToText(t.message.content);
}

/**
 * 按 token 预算截断，保留头尾、丢掉中段
 *
 * 只在**单条消息自己就超过整轮预算**时才触发（用户粘了几十万字的情况），
 * 这时压缩请求必须被兜住，否则整个调用会超出模型窗口直接报错。
 *
 * 不是常规过滤器 —— 正常批次靠 pickBatch 控制总量，不靠砍单条。
 *
 * 比例法：复用 estimateTextTokens 估总量，按比例回推该留多少字符。
 * 中英混排时是近似的，但对「中段丢弃」这个用途足够。
 */
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

/**
 * 本轮压缩批次的选取结果
 */
interface PickedBatch {
  /** 实际要压缩的消息（最早的若干条） */
  batch: TrackedMessage[];
  /** 批内消息的完整字符数（压缩比的分母，不是发给模型的字数） */
  fullChars: number;
  /** 因为单条超预算而被截断的消息数 */
  truncatedCount: number;
  /** 被截断而未进入 prompt 的字符数 */
  omittedChars: number;
}

/**
 * 按 token 预算装批：从最早的消息开始往里装，装满 ROUND_TOKEN_BUDGET 为止
 *
 * @param maxCount 最多能取几条（= 可压条数，保证最近 keepTarget 条不动）
 *
 * 返回的 batch **一定是空的或非空的最小保证**：哪怕第一条自己就超预算，
 * 也会取它（截断后送进 prompt），否则本轮无法推进，会死循环。
 */
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

    // 已经装了东西之后再遇到超预算的，就到此为止 —— 下一轮继续压它
    if (batch.length > 0 && used + textTokens > ROUND_TOKEN_BUDGET) break;

    if (textTokens > ROUND_TOKEN_BUDGET) {
      // 单条就超预算：安全阀生效，截断后送进去
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

/**
 * 把消息转成压缩 prompt 需要的纯文本
 *
 * 默认**不做任何截断** —— 批内总量已由 pickBatch 控住。
 * 只有超预算的单条才会被 messagesToText 二次收口，保证实际发送量不超标。
 */
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

/**
 * 生成「本批含节选」的声明，插进压缩 prompt 的 system 段
 *
 * 为什么需要：节选情况下模型只看到一部分内容，却会照常写出一份
 * 自信的摘要，整条消息随后被标记为已压缩 —— 中段就此永久消失，
 * 而界面上和用户那里都没有任何提示。这跟 read_note 的 truncated 标记
 * 是同一个道理，只是那边有、这边没有。
 */
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

/**
 * 估算当前热状态的总 token（摘要 + 原始消息）
 */
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

/**
 * 检查并按需压缩会话历史
 *
 * @param DB     knex 实例
 * @param sessionId  会话 id
 * @param model  用于生成摘要的 chat model（复用主对话的那个，省一次配置加载）
 * @param onProgress 进度回调，用于驱动 UI 的「正在压缩」提示
 */
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

  // 确实要压缩了 —— 通知 UI，别让用户对着一个不动的界面猜
  onProgress?.({ phase: 'compressing', maxRounds: MAX_ROUNDS, tokens: initialTokens });

  let rounds = 0;
  let stoppedBy: CompactStopReason = 'rounds-exhausted';
  /** 有多少轮发生了「节选压缩」——> 0 意味着有内容在摘要器没看到的情况下永久离开了 prompt */
  let truncatedRounds = 0;
  let omittedChars = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    state = await getHotState(DB, sessionId);
    const currentTokens = estimateStateTokens(state);

    if (currentTokens <= WATERMARK_TOKENS) {
      stoppedBy = 'watermark';
      break;
    }

    // 本轮保留多少条最近的消息：
    //   消息够多就保 KEEP_RECENT 条；条数本身就少（每条都是超长快照）时
    //   退到 MIN_RECENT，否则 compressibleCount 恒为 0，永远压不动。
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

    // 本轮要压缩的：最早的一批，保证最近 keepTarget 条不动。
    // 装批按 token 预算而非条数比例 —— 400 字摘要覆盖 12000 token 是 10:1，
    // 覆盖 28000 就成 70:1。宁可多压几轮（每份摘要各管一小段），
    // 也不要一轮猛塞然后靠砍单条来凑数。
    const picked = pickBatch(state.messages, compressibleCount);
    const batch = picked.batch;

    // 从 TrackedMessage 拿 DB id 范围（用于删除）
    const firstId = batch[0].id;
    const lastId = batch[batch.length - 1].id;

    if (firstId < 0 || lastId < 0) {
      // 内存里这批消息没有有效 id（appendToHotState 没拿到写库返回值）——
      // 不能安全删除，强制重建缓存后再试
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
      // 压缩失败不影响主流程 — 保持原样
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

    // 写摘要（保留旧摘要 + 新摘要，实现多阶段演进）
    await DB('ai_chat_summary').insert({
      session_id: sessionId,
      from_message_id: firstId,
      to_message_id: lastId,
      summary: summaryText,
      compressed_count: batch.length,
      compressed_chars: batchChars,
      created_at: new Date(),
    });

    // 软删除：只标记 compressed=1，不物理删除
    // 原始内容保留在库里（前端历史列表仍可完整翻阅），
    // 只是不再进入 prompt 的热记忆区（getHotState 只读 compressed=0）
    await DB('ai_chat')
      .where('session_id', sessionId)
      .whereBetween('id', [firstId, lastId])
      .update({ compressed: 1 });

    // 同步内存
    applyCompression(sessionId, summaryText, batch.length);
    rounds += 1;
    if (picked.truncatedCount > 0) {
      truncatedRounds += 1;
      omittedChars += picked.omittedChars;
    }

    log.info(`[compact] session ${sessionId} round ${round + 1} done`, {
      compressed: batch.length,
      batchChars: picked.fullChars,
      // 压缩比：本批原文多少字 → 摘要多少字。比值越大丢得越干净
      ratio: `${Math.round(picked.fullChars / Math.max(1, summaryText.length))}:1`,
      messagesLeft: state.messages.length - batch.length,
      summaryChars: summaryText.length,
    });

    // 节选压缩要单独 warn —— 这意味着有内容在摘要器没看到的情况下
    // 永远离开了 prompt，只在日志里留痕，界面上不会提示用户。
    if (picked.truncatedCount > 0) {
      log.warn(
        `[compact] session ${sessionId} round ${round + 1}: ${picked.truncatedCount} 条超长消息被截断，` +
          `${picked.omittedChars} 字未进入摘要（占本批 ${Math.round(
            (picked.omittedChars / Math.max(1, picked.fullChars)) * 100
          )}%）`
      );
    }

    // 每轮报一次，UI 可以显示「正在压缩 (n/m)」
    onProgress?.({ phase: 'compressing', round: rounds, maxRounds: MAX_ROUNDS, tokens: currentTokens });

    // 只留最近 keepTarget 条也够不到水位 —— 说明压不下去了。
    // 再压一轮只是多等一次 LLM，上下文并不会更短，到此收手。
    if (watermarkUnreachable(state, keepTarget)) {
      log.info(`[compact] session ${sessionId} watermark unreachable, stop after round ${rounds}`, {
        messagesLeft: state.messages.length,
        keepTarget,
      });
      stoppedBy = 'floor-unreachable';
      break;
    }
  }

  // 压缩后强制重建一次缓存，确保和 DB 完全一致
  const finalState = await rebuildHotState(DB, sessionId);

  // 无论压缩了几轮都要收尾通知，否则 UI 的提示会一直挂着
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

/** 导出阈值常量给设置页/调试用 */
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
