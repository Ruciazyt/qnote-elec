import { log } from "../../main/utils/log";
import { D1Client } from "./d1Client";
import { SharedStoreOnExecutor, type SqlExecutor, type SharedStore } from "./sharedStore";
import type { D1Config } from "../../shared/cloudTypes";

/**
 * D1 的语句执行器
 *
 * 把 `SqlExecutor` 的两个方法翻译成 D1 REST 的形状：
 *
 * - `all` → 一次 `/query` 请求，读 `result[0].results`
 * - `batch` → 一次 `/query` 请求带 `batch` 数组
 *
 * ## batch 才是 D1 上的原子性来源
 *
 * D1 把每条查询包在自己的隐式事务里，`BEGIN` / `COMMIT` 跨请求无效。
 * 但一次请求里的多条语句（batch）**是**一个 SQL 事务：
 * 任何一条失败，整批回滚。所以凡是需要原子性的地方，
 * 都必须走 `batch`，不能拆成多次 `all`。
 */
export class D1SqlExecutor implements SqlExecutor {
  constructor(private readonly client: D1Client) {}

  async all<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const results = await this.client.query<T>(sql, params);
    return results;
  }

  async batch(
    statements: Array<{ sql: string; params?: unknown[] }>
  ): Promise<void> {
    if (statements.length === 0) return;
    await this.client.batch(
      statements.map((s) => ({ sql: s.sql, params: s.params ?? [] }))
    );
  }
}

/** 用一份 D1 配置建一个共享存储（直连 Cloudflare REST） */
export function createD1SharedStore(config: D1Config): {
  store: SharedStore;
  client: D1Client;
} {
  const client = new D1Client(config);
  log.info("[cloud] 使用 D1 共享存储（直连）", {
    accountId: config.accountId,
    databaseId: config.databaseId,
  });
  return {
    store: new SharedStoreOnExecutor("d1", new D1SqlExecutor(client)),
    client,
  };
}

/**
 * 用一个公共目录地址建共享存储（走 Worker 代理）
 *
 * 与直连的区别只有两点：**不需要令牌**，**不需要账号 / 库 ID**。
 * 协议（请求体、响应体）完全一致 —— Worker 把 D1 的形状原样吐回来，
 * 所以上面那套 SharedStoreOnExecutor 一行都不用改。
 */
export function createEndpointSharedStore(endpoint: string): {
  store: SharedStore;
  client: D1Client;
} {
  const client = new D1Client({ endpoint });
  log.info("[cloud] 使用公共目录（Worker 代理）", { endpoint });
  return {
    store: new SharedStoreOnExecutor("public", new D1SqlExecutor(client)),
    client,
  };
}
