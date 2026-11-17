
import type { Knex } from 'knex';
import { log } from "../../system/log";

export type UsageKind = 'llm' | 'tool';

export interface UsageRecord {
  provider: string;
  model: string;
  sessionId?: string | null;
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

function pickToken(source: Record<string, unknown> | undefined, ...keys: string[]): number {
  if (!source) return 0;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return num(source[key]);
    }
  }
  return 0;
}

export function extractTokenUsage(
  llmOutput?: Record<string, any> | null,
  usageMetadata?: Record<string, any> | null
): TokenUsage {
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

  const tokenUsage = llmOutput.tokenUsage as Record<string, unknown> | undefined;
  if (tokenUsage) {
    const p = pickToken(tokenUsage, 'promptTokens', 'prompt_tokens', 'input_tokens');
    const c = pickToken(tokenUsage, 'completionTokens', 'completion_tokens', 'output_tokens');
    const t = pickToken(tokenUsage, 'totalTokens', 'total_tokens') || p + c;
    if (p || c || t) return { promptTokens: p, completionTokens: c, totalTokens: t };
  }

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

export function classifyError(err: unknown): {
  type: string;
  message: string;
} {
  const anyErr = err as any;
  const message =
    anyErr?.message ||
      (err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : (JSON.stringify(err) ?? String(err ?? '')));
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

export class UsageRecorder {
  private pending = 0;
  private failed = 0;

  constructor(private DB: Knex) {}

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

  stats(): { pending: number; failed: number } {
    return { pending: this.pending, failed: this.failed };
  }
}

let _recorder: UsageRecorder | null = null;

export function initUsageRecorder(DB: Knex): UsageRecorder {
  _recorder = new UsageRecorder(DB);
  return _recorder;
}

export function getUsageRecorder(): UsageRecorder | null {
  return _recorder;
}

export function recordUsage(rec: UsageRecord): void {
  if (!_recorder) {
    return;
  }
  _recorder.record(rec);
}
