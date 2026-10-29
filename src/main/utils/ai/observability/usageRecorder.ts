/**
 * AI 用量记录层
 *
 * 职责：把每次 LLM / 工具调用的关键指标写进 ai_usage_log 表。
 *
 * 记录内容（用户 2026-09-28 决策）：
 *   - token 用量（prompt / completion / total）
 *   - 延迟
 *   - 成功/失败 + 错误分类
 *   - provider / model / session / agent 轮次
 *   - **不算金额**（价格会过期，避免硬编码）
 *
 * 关键设计：llmOutput 字段各 provider 不同
 *   - OpenAI 兼容（含 DeepSeek）: { tokenUsage: { promptTokens, completionTokens, totalTokens } }
 *   - Anthropic:                { usage: { input_tokens, output_tokens } }
 *   - 部分 provider:             直接挂在 llmOutput 上的 snake_case 字段
 * 所以要写一个多路兜底的提取器。
 */

import type { Knex } from 'knex';
import { log } from '../../log';

export type UsageKind = 'llm' | 'tool';

export interface UsageRecord {
  provider: string;
  model: string;
  sessionId?: string | null;
  /** agent 循环的第几轮（0 = 单次调用） */
  agentIteration?: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  kind?: UsageKind;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const ZERO_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 从任意形状的 usage 对象里读一个 token 字段（支持 camelCase / snake_case） */
function pickToken(source: Record<string, unknown> | undefined, ...keys: string[]): number {
  if (!source) return 0;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return num(source[key]);
    }
  }
  return 0;
}

/**
 * 从 LangChain 的 llmOutput / usage_metadata 里提取 token 用量
 *
 * 覆盖的 provider 形态（实测 + 文档核对）：
 *   - OpenAI / DeepSeek / Azure:      llmOutput.tokenUsage.{promptTokens,completionTokens,totalTokens}
 *   - Anthropic:                     llmOutput.usage.{input_tokens,output_tokens} 或 llmOutput.{input_tokens,output_tokens}
 *   - 已经是标准 UsageMetadata 的:     usage_metadata.{input_tokens,output_tokens,total_tokens}
 *   - OpenAI Responses API:           llmOutput.{input_tokens,output_tokens,total_tokens}
 */
export function extractTokenUsage(
  llmOutput?: Record<string, any> | null,
  usageMetadata?: Record<string, any> | null
): TokenUsage {
  // 优先用标准 usage_metadata（LangChain 1.x 已把各 provider 归一化到这里）
  if (usageMetadata) {
    const input = pickToken(usageMetadata, 'input_tokens', 'prompt_tokens', 'promptTokens');
    const output = pickToken(
      usageMetadata,
      'output_tokens',
      'completion_tokens',
      'completionTokens'
    );
    const total = pickToken(usageMetadata, 'total_tokens', 'totalTokens') || input + output;
    if (input || output || total) {
      return { promptTokens: input, completionTokens: output, totalTokens: total };
    }
  }

  if (!llmOutput) return ZERO_USAGE;

  // 路径 1：OpenAI SDK 的 tokenUsage
  const tokenUsage = llmOutput.tokenUsage as Record<string, unknown> | undefined;
  if (tokenUsage) {
    const p = pickToken(tokenUsage, 'promptTokens', 'prompt_tokens', 'input_tokens');
    const c = pickToken(tokenUsage, 'completionTokens', 'completion_tokens', 'output_tokens');
    const t = pickToken(tokenUsage, 'totalTokens', 'total_tokens') || p + c;
    if (p || c || t) return { promptTokens: p, completionTokens: c, totalTokens: t };
  }

  // 路径 2：Anthropic 的 usage 子对象
  const anthropicUsage = llmOutput.usage as Record<string, unknown> | undefined;
  if (anthropicUsage) {
    const p = pickToken(anthropicUsage, 'input_tokens', 'prompt_tokens', 'inputTokens');
    const c = pickToken(
      anthropicUsage,
      'output_tokens',
      'completion_tokens',
      'outputTokens'
    );
    if (p || c) {
      return { promptTokens: p, completionTokens: c, totalTokens: p + c };
    }
  }

  // 路径 3：直接挂在 llmOutput 顶层
  const p = pickToken(llmOutput, 'input_tokens', 'prompt_tokens', 'promptTokens');
  const c = pickToken(
    llmOutput,
    'output_tokens',
    'completion_tokens',
    'completionTokens'
  );
  if (p || c) {
    const t = pickToken(llmOutput, 'total_tokens', 'totalTokens') || p + c;
    return { promptTokens: p, completionTokens: c, totalTokens: t };
  }

  return ZERO_USAGE;
}

/**
 * 错误分类 —— 把五花八门的错误收敛成几个可统计的类别
 */
export function classifyError(err: unknown): {
  type: string;
  message: string;
} {
  const anyErr = err as any;
  const message =
    anyErr?.message || (err instanceof Error ? err.message : String(err ?? ''));
  const status: number | undefined =
    anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status;
  const name: string = anyErr?.name ?? '';

  if (name === 'AbortError' || /abort/i.test(message)) {
    return { type: 'aborted', message };
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return { type: 'timeout', message };
  }
  if (/ENOTFOUND|ENETUNREACH|ECONNREFUSED|fetch failed|network/i.test(message)) {
    return { type: 'network', message };
  }
  if (status === 401 || status === 403 || /unauthorized|api key|invalid.*key/i.test(message)) {
    return { type: 'auth', message };
  }
  if (status === 429 || /rate limit|too many requests|quota/i.test(message)) {
    return { type: 'rate_limit', message };
  }
  if (status === 400) {
    return { type: 'bad_request', message };
  }
  if (status && status >= 500) {
    return { type: 'server_error', message };
  }
  if (status && status >= 400) {
    return { type: `http_${status}`, message };
  }
  return { type: 'unknown', message };
}

/**
 * 用量记录器 — 持有 DB 引用，异步写库（不阻塞主流程）
 */
export class UsageRecorder {
  private pending = 0;
  private failed = 0;

  constructor(private DB: Knex) {}

  /**
   * 写一条用量记录
   *
   * 故意不 await：可观测性不能影响主链路。
   * 写失败只记日志，不抛出。
   */
  record(rec: UsageRecord): void {
    this.pending += 1;
    void this.DB('ai_usage_log')
      .insert({
        provider: rec.provider || 'unknown',
        model: rec.model || '',
        session_id: rec.sessionId ?? null,
        agent_iteration: rec.agentIteration ?? 0,
        prompt_tokens: num(rec.promptTokens),
        completion_tokens: num(rec.completionTokens),
        total_tokens: num(rec.totalTokens),
        latency_ms: Math.max(0, Math.round(num(rec.latencyMs))),
        success: rec.success,
        error_type: rec.errorType ?? '',
        error_message: (rec.errorMessage ?? '').slice(0, 500),
        kind: rec.kind ?? 'llm',
        created_at: new Date(),
      })
      .then(() => {
        this.pending -= 1;
      })
      .catch((err) => {
        this.pending -= 1;
        this.failed += 1;
        log.warn('[usage] 写入用量记录失败:', err);
      });
  }

  /** 统计信息（调试用） */
  stats(): { pending: number; failed: number } {
    return { pending: this.pending, failed: this.failed };
  }
}

/** 全局单例（由 registerAiHandlers 初始化） */
let _recorder: UsageRecorder | null = null;

export function initUsageRecorder(DB: Knex): UsageRecorder {
  _recorder = new UsageRecorder(DB);
  return _recorder;
}

export function getUsageRecorder(): UsageRecorder | null {
  return _recorder;
}

/** 未初始化时的安全 no-op（避免测试/早期启动报错） */
export function recordUsage(rec: UsageRecord): void {
  if (!_recorder) {
    // recorder 未初始化（早期启动 / 单元测试）—— 静默跳过，
    // 可观测性绝不能因为自身问题影响主流程
    return;
  }
  _recorder.record(rec);
}
