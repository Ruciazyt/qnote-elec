import { log } from "../../main/utils/log";
import type { D1Config } from "../../shared/cloudTypes";

/**
 * Cloudflare D1 的 REST 客户端
 *
 * ## 为什么直接打 REST，不走 Worker
 *
 * D1 的原生入口是 Worker 绑定（`env.DB`），那要求用户先部署一个 Worker。
 * 而 D1 同时暴露了 HTTP REST 接口：
 *
 * ```
 * POST https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query
 * Authorization: Bearer <token>
 * { "sql": "...", "params": [...] }
 * ```
 *
 * 桌面端直连 REST 少一个需要部署、需要维护、还要保证在线的组件 ——
 * 用户填三个值就能用上。代价是每次查询都要走一次网络往返，
 * 所以共享存储层只放读多写少的数据（见 docs/CLOUD-STORAGE.md）。
 *
 * ## D1 的几条硬约束（都影响这里的实现）
 *
 * 1. **没有交互式事务。** D1 把每条查询包在隐式事务里，
 *    `BEGIN` / `COMMIT` 跨请求没有意义。真正能当事务用的是
 *    **batch**（一次请求里发多条语句，要么全成要么全滚）。
 *    本客户端的 `batch()` 就是这个语义。
 * 2. **参数上限 100 个**，SQL 语句长度上限 100KB，单行上限约 2MB。
 * 3. **只读查询会自动重试，写查询不会。** 所以这里只对读操作重试，
 *    写操作宁可报错也不重试 —— 重试一次写可能变成写两条。
 * 4. **PRAGMA 只支持一部分**：`table_info` / `table_list` / `index_list` 等有，
 *    `journal_mode` / `synchronous` / `wal_checkpoint` 没有。
 */

/** D1 单条查询的响应体里，每条语句对应的那一段 */
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

/** D1 REST 的整体响应 */
interface D1Response {
  success: boolean;
  result?: D1QueryResult[];
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

/** 一次批处理里的一条语句 */
export interface D1Statement {
  sql: string;
  params?: unknown[];
}

/** D1 客户端抛出的错误 —— 带上 Cloudflare 的错误码，便于定位 */
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

/**
 * 可以重试的 D1 错误码
 *
 * - 7429：DB 过载，请求排队太久
 * - 7500：平台侧存储事件，数据库临时不可用
 * - 7403 / 10000：鉴权失败 —— 重试没用
 *
 * 「网络连接丢失」「副本断开」这类是 HTTP 层失败，也重试。
 */
const RETRYABLE_CODES = new Set([7429, 7500]);

/** 读操作 —— 只有它们允许自动重试 */
function isReadOnlySql(sql: string): boolean {
  const head = sql.trim().toUpperCase();
  return head.startsWith("SELECT") || head.startsWith("WITH") || head.startsWith("PRAGMA");
}

/** D1 客户端的构造参数 */
export interface D1ClientOptions {
  /** Cloudflare 账号 ID —— 直连 D1 时必填 */
  accountId?: string;
  /** D1 数据库 ID —— 直连 D1 时必填 */
  databaseId?: string;
  /** API Token —— 直连 D1 时必填；走 Worker 代理时不需要 */
  apiToken?: string;
  /**
   * 自定义端点 —— 公共目录（Worker 代理）模式用
   *
   * 给了它就不走 Cloudflare REST，也**不需要任何令牌**：
   * 请求直接发到这个地址，凭据由 Worker 那边管。
   * 这个地址是公开的，可以内置进安装包。
   */
  endpoint?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 重试次数（仅对只读查询生效） */
  maxRetries?: number;
  /** 注入 fetch —— 测试用 */
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
    // 两种模式：
    //   - 给了 endpoint → 公共目录代理，请求打过去，不带 Authorization
    //   - 没给 endpoint → 直连 Cloudflare REST，要账号 / 库 / 令牌
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

  /**
   * 执行一条语句
   *
   * @returns 该语句返回的行（没有则空数组）
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const results = await this.run([{ sql, params }]);
    return (results[0]?.results ?? []) as T[];
  }

  /**
   * 批处理 —— 一次请求发多条语句
   *
   * D1 把 batch 当作**一个 SQL 事务**：其中任何一条失败，
   * 整批回滚。这是 D1 上唯一能拿到原子性的手段，
   * 所以共享存储里凡是需要「两条语句要么都成要么都不成」的地方，
   * 都走这里，而不是自己拼 BEGIN / COMMIT。
   */
  async batch(statements: D1Statement[]): Promise<D1QueryResult[]> {
    if (statements.length === 0) return [];
    return await this.run(statements);
  }

  /**
   * 真正发请求的那一层
   *
   * 只读语句失败会重试；写语句不重试 —— D1 那边也不重试写，
   * 我们再重试一次就可能变成写了两条。
   */
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
        // 指数退避 + 抖动：多个客户端同时失败时不要一起冲上去
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

  /** 真的发出去 */
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

    // 直连 Cloudflare 要带 Bearer；走 Worker 代理时不带 ——
    // 那边本来就不认令牌，带了反而可能被当成「伪造的客户端」。
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
      // fetch 本身失败 = 网络层失败
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

    // 批处理里单条失败：整批回滚了，但要指出是哪一条
    const failed = results.find((r) => r && r.success === false);
    if (failed) {
      throw new D1Error(failed.error ?? "D1 语句执行失败");
    }

    return results;
  }

  /** 判断这个错误值不值得重试 */
  private isRetryable(error: unknown): boolean {
    if (!(error instanceof D1Error)) return false;
    if (error.code === undefined) return true; // 网络层失败
    return RETRYABLE_CODES.has(error.code);
  }

  /** 批量语句里最后一条的影响行数 */
  static changesOf(result: D1QueryResult | undefined): number {
    return result?.meta?.changes ?? 0;
  }
}
