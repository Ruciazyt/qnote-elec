import { log } from "../../main/core/system/log";
import type { D1Config } from "../../shared/cloud/cloudTypes";


interface D1QueryResult {
  success: boolean;
  results?: unknown[];
  meta?: {
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
    duration?: number;
  };
  error?: string;
}

interface D1Response {
  success: boolean;
  result?: D1QueryResult[];
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

export interface D1Statement {
  sql: string;
  params?: unknown[];
}

export class D1Error extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "D1Error";
  }
}

const RETRYABLE_CODES = new Set([7429, 7500]);

function isReadOnlySql(sql: string): boolean {
  const head = sql.trim().toUpperCase();
  return head.startsWith("SELECT") || head.startsWith("WITH") || head.startsWith("PRAGMA");
}

export interface D1ClientOptions {
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  endpoint?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

export class D1Client {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: D1ClientOptions) {
    const custom = options.endpoint?.trim();
    this.endpoint = custom
      ? custom.replace(/\/+$/, "")
      : `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
          options.accountId ?? ""
        )}/d1/database/${encodeURIComponent(options.databaseId ?? "")}/query`;
    this.token = options.apiToken?.trim() ?? "";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const results = await this.run([{ sql, params }]);
    return (results[0]?.results ?? []) as T[];
  }

  async batch(statements: D1Statement[]): Promise<D1QueryResult[]> {
    if (statements.length === 0) return [];
    return await this.run(statements);
  }

  private async run(statements: D1Statement[]): Promise<D1QueryResult[]> {
    const allowRetry = statements.length === 1 && isReadOnlySql(statements[0].sql);
    const attempts = allowRetry ? this.maxRetries + 1 : 1;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.send(statements);
      } catch (error) {
        lastError = error;
        const retryable = allowRetry && attempt < attempts - 1 && this.isRetryable(error);
        if (!retryable) throw error;
        const delay = 400 * 2 ** attempt + Math.random() * 250;
        log.warn(
          `[d1] 查询失败，第 ${attempt + 1}/${attempts} 次重试（${delay}ms 后）：`,
          error instanceof Error ? error.message : error
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  private async send(statements: D1Statement[]): Promise<D1QueryResult[]> {
    const body =
      statements.length === 1
        ? { sql: statements[0].sql, params: statements[0].params ?? [] }
        : {
            batch: statements.map((s) => ({
              sql: s.sql,
              params: s.params ?? [],
            })),
          };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new D1Error(`D1 请求超时（${this.timeoutMs}ms）`, undefined, error);
      }
      throw new D1Error(
        `无法连接云端存储：${error instanceof Error ? error.message : String(error)}`,
        undefined,
        error
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: D1Response;
    try {
      payload = (await response.json()) as D1Response;
    } catch (error) {
      throw new D1Error(
        `D1 响应不是合法 JSON（HTTP ${response.status}）`,
        undefined,
        error
      );
    }

    if (!response.ok) {
      const first = payload.errors?.[0] ?? payload.messages?.[0];
      throw new D1Error(
        first?.message ?? `D1 请求失败（HTTP ${response.status}）`,
        first?.code
      );
    }

    if (payload.success === false) {
      const first = payload.errors?.[0] ?? payload.messages?.[0];
      throw new D1Error(first?.message ?? "D1 请求失败", first?.code);
    }

    const results = payload.result ?? [];

    const failed = results.find((r) => r && r.success === false);
    if (failed) {
      throw new D1Error(failed.error ?? "D1 语句执行失败");
    }

    return results;
  }

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof D1Error)) return false;
    if (error.code === undefined) return true;
    return RETRYABLE_CODES.has(error.code);
  }

  static changesOf(result: D1QueryResult | undefined): number {
    return result?.meta?.changes ?? 0;
  }
}
