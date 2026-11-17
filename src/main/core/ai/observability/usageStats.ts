
import type { Knex } from 'knex';
import { log } from '../../system/log';

export interface UsageTotals {
  calls: number;
  llmCalls: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  errorCount: number;
  errorRate: number;
}

export interface UsageByModel {
  provider: string;
  model: string;
  calls: number;
  totalTokens: number;
  avgLatencyMs: number;
  errorCount: number;
}

export interface UsageByDay {
  date: string;
  calls: number;
  totalTokens: number;
  errorCount: number;
}

export interface UsageRecordRow {
  id: number;
  provider: string;
  model: string;
  kind: string;
  agentIteration: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  errorType: string;
  errorMessage: string;
  sessionId: string | null;
  createdAt: string;
}

export interface UsageStats {
  today: UsageTotals;
  week: UsageTotals;
  all: UsageTotals;
  byModel: UsageByModel[];
  byDay: UsageByDay[];
  recent: UsageRecordRow[];
}

const EMPTY_TOTALS: UsageTotals = {
  calls: 0,
  llmCalls: 0,
  toolCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  avgLatencyMs: 0,
  errorCount: 0,
  errorRate: 0,
};

function startOfDay(daysAgo: number = 0): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(): number {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const EPOCH = 0;

function msToLocalDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class UsageStatsService {
  constructor(private DB: Knex) {}

  private async totalsSince(sinceMs: number): Promise<UsageTotals> {
    const row = await this.DB('ai_usage_log')
      .where('created_at', '>=', sinceMs)
      .count('* as calls')
      .sum({ promptTokens: 'prompt_tokens' })
      .sum({ completionTokens: 'completion_tokens' })
      .sum({ totalTokens: 'total_tokens' })
      .avg('latency_ms as avgLatency')
      .first();

    if (!row) return { ...EMPTY_TOTALS };

    const errRow = await this.DB('ai_usage_log')
      .where('created_at', '>=', sinceMs)
      .where('success', 0)
      .count('* as c')
      .first();

    const calls = Number(row.calls) || 0;
    const errorCount = Number(errRow?.c) || 0;

    return {
      calls,
      llmCalls: await this.countKind(sinceMs, 'llm'),
      toolCalls: await this.countKind(sinceMs, 'tool'),
      promptTokens: Number(row.promptTokens) || 0,
      completionTokens: Number(row.completionTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
      avgLatencyMs: Math.round(Number(row.avgLatency) || 0),
      errorCount,
      errorRate: calls > 0 ? Number((errorCount / calls).toFixed(4)) : 0,
    };
  }

  private async countKind(sinceMs: number, kind: string): Promise<number> {
    const r = await this.DB('ai_usage_log')
      .where('created_at', '>=', sinceMs)
      .where('kind', kind)
      .count('* as c')
      .first();
    return Number(r?.c) || 0;
  }

  async byModel(sinceMs?: number): Promise<UsageByModel[]> {
    let q = this.DB('ai_usage_log').where('kind', 'llm');
    if (sinceMs) q = q.where('created_at', '>=', sinceMs);

    const rows = await q
      .select('provider', 'model')
      .count('* as calls')
      .sum({ totalTokens: 'total_tokens' })
      .avg('latency_ms as avgLatency')
      .groupBy('provider', 'model')
      .orderBy('calls', 'desc');

    const result: UsageByModel[] = [];
    for (const r of rows) {
      const err = await this.DB('ai_usage_log')
        .where('provider', r.provider)
        .where('model', r.model)
        .where('kind', 'llm')
        .where('success', 0)
        .count('* as c')
        .first();
      result.push({
        provider: r.provider,
        model: r.model || '(default)',
        calls: Number(r.calls) || 0,
        totalTokens: Number(r.totalTokens) || 0,
        avgLatencyMs: Math.round(Number(r.avgLatency) || 0),
        errorCount: Number(err?.c) || 0,
      });
    }
    return result;
  }

  async byDay(days: number = 14): Promise<UsageByDay[]> {
    const since = startOfDay(days - 1);
    const rows = await this.DB('ai_usage_log')
      .where('created_at', '>=', since)
      .select('created_at')
      .orderBy('created_at', 'asc');

    const buckets = new Map<string, UsageByDay>();
    for (const r of rows) {
      const ts = Number(r.created_at);
      if (!Number.isFinite(ts)) continue;
      const key = msToLocalDate(ts);
      const bucket = buckets.get(key) ?? {
        date: key,
        calls: 0,
        totalTokens: 0,
        errorCount: 0,
      };
      bucket.calls += 1;
      buckets.set(key, bucket);
    }

    const tokenRows = await this.DB('ai_usage_log')
      .where('created_at', '>=', since)
      .select('created_at', 'total_tokens')
      .orderBy('created_at', 'asc');
    for (const r of tokenRows) {
      const ts = Number(r.created_at);
      if (!Number.isFinite(ts)) continue;
      const bucket = buckets.get(msToLocalDate(ts));
      if (bucket) bucket.totalTokens += Number(r.total_tokens) || 0;
    }

    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async recent(limit: number = 50): Promise<UsageRecordRow[]> {
    const rows = await this.DB('ai_usage_log')
      .select('*')
      .orderBy('id', 'desc')
      .limit(limit);

    return rows.map((r: any) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      kind: r.kind,
      agentIteration: r.agent_iteration,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      latencyMs: r.latency_ms,
      success: !!r.success,
      errorType: r.error_type,
      errorMessage: r.error_message,
      sessionId: r.session_id,
      createdAt: r.created_at,
    }));
  }

  async getStats(): Promise<UsageStats> {
    try {
      const [today, week, all, byModel, byDay, recent] = await Promise.all([
        this.totalsSince(startOfDay(0)),
        this.totalsSince(startOfWeek()),
        this.totalsSince(EPOCH),
        this.byModel(),
        this.byDay(14),
        this.recent(50),
      ]);

      return { today, week, all, byModel, byDay, recent };
    } catch (err) {
      log.error('[usage] 统计查询失败:', err);
      return {
        today: { ...EMPTY_TOTALS },
        week: { ...EMPTY_TOTALS },
        all: { ...EMPTY_TOTALS },
        byModel: [],
        byDay: [],
        recent: [],
      };
    }
  }
}
