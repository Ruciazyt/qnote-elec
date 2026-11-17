import { log } from "../../main/core/system/log";
import { D1Client } from "./d1Client";
import { SharedStoreOnExecutor, type SqlExecutor, type SharedStore } from "./sharedStore";
import type { D1Config } from "../../shared/cloud/cloudTypes";

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
