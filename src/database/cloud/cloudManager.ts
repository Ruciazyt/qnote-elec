import type { Knex } from "knex";
import { log } from "../../main/core/system/log";
import {
  DEFAULT_CLOUD_CONFIG,
  getSharedStore,
  loadCloudConfig,
  resetSharedStore,
  saveCloudConfig,
} from "./config";
import { createD1SharedStore, createEndpointSharedStore } from "./d1Store";
import { resolveDefaultEndpoint } from "./defaults";
import type { SharedStore } from "./sharedStore";
import type {
  CloudBackend,
  CloudConnectionStatus,
  CloudStorageConfig,
  D1Config,
  PublishedApp,
  PublishedAppInput,
  PublishedAppListResult,
  PublishedAppQuery,
} from "../../shared/cloud/cloudTypes";


let store: SharedStore | null = null;

let localDB: Knex | null = null;

export function initCloudStorage(DB: Knex): void {
  localDB = DB;
  store = null;
}

export async function getStore(): Promise<SharedStore> {
  if (!localDB) {
    throw new Error("云端存储尚未初始化");
  }
  if (!store) {
    store = await getSharedStore(localDB);
  }
  return store;
}

export async function getConfig(): Promise<CloudStorageConfig> {
  if (!localDB) {
    return { ...DEFAULT_CLOUD_CONFIG };
  }
  return await loadCloudConfig(localDB);
}

export async function updateConfig(input: {
  backend?: CloudBackend;
  d1?: D1Config | null;
  endpoint?: string | null;
}): Promise<{ ok: boolean; error?: string; config: CloudStorageConfig }> {
  if (!localDB) {
    return {
      ok: false,
      error: "云端存储尚未初始化",
      config: { ...DEFAULT_CLOUD_CONFIG },
    };
  }

  const current = await loadCloudConfig(localDB);
  const next: CloudStorageConfig = {
    backend: input.backend ?? current.backend,
    d1: input.d1 === undefined ? current.d1 : input.d1,
    endpoint: input.endpoint === undefined ? current.endpoint : input.endpoint,
    lastCheck: null,
  };

  if (next.backend === "d1") {
    if (!next.d1) {
      return {
        ok: false,
        error: "切换到 D1 前请先填好账号 ID、数据库 ID 与 API Token",
        config: current,
      };
    }
    const status = await checkD1(next.d1);
    if (!status.ok) {
      return {
        ok: false,
        error: status.error ?? "D1 连通性检查未通过",
        config: current,
      };
    }
    next.lastCheck = status;
  }

  if (next.backend === "public") {
    const endpoint = (next.endpoint ?? "").trim() || resolveDefaultEndpoint();
    if (!endpoint) {
      return {
        ok: false,
        error: "公共目录地址为空 —— 请填地址，或让构建流程注入 QNOTE_CLOUD_ENDPOINT",
        config: current,
      };
    }
    next.endpoint = endpoint;
    const status = await checkEndpoint(endpoint);
    if (!status.ok) {
      return {
        ok: false,
        error: status.error ?? "公共目录连通性检查未通过",
        config: current,
      };
    }
    next.lastCheck = status;
  }

  await saveCloudConfig(localDB, next);
  await resetSharedStore();
  store = null;
  log.info("[cloud] 配置已更新", { backend: next.backend });

  return { ok: true, config: next };
}

export async function checkD1(config: D1Config): Promise<CloudConnectionStatus> {
  try {
    const { store: d1Store, client } = createD1SharedStore(config);

    await d1Store.init();

    const rows = await client.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const tableCount = rows.length;

    return {
      ok: true,
      tableCount,
      detail: `已连接，共 ${tableCount} 张表`,
    };
  } catch (error) {
    return {
      ok: false,
      error: describeCloudError(error),
    };
  }
}

export async function checkEndpoint(
  endpoint: string
): Promise<CloudConnectionStatus> {
  try {
    const { store, client } = createEndpointSharedStore(endpoint);
    await store.init();

    const rows = await client.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    return {
      ok: true,
      tableCount: rows.length,
      detail: `已连接公共目录，共 ${rows.length} 张表`,
    };
  } catch (error) {
    return {
      ok: false,
      error: describeCloudError(error),
    };
  }
}

export async function switchBackend(
  backend: CloudBackend
): Promise<{ ok: boolean; error?: string; config: CloudStorageConfig }> {
  return await updateConfig({ backend });
}

export async function listApps(
  query?: PublishedAppQuery
): Promise<PublishedAppListResult> {
  const current = await getStore();
  return await current.list(query);
}

export async function getApp(id: string): Promise<PublishedApp | null> {
  const current = await getStore();
  return await current.get(id);
}

export async function publishApp(
  input: PublishedAppInput,
  existingId?: string
): Promise<PublishedApp> {
  const current = await getStore();
  return await current.publish(input, existingId);
}

export async function removeApp(id: string): Promise<boolean> {
  const current = await getStore();
  return await current.remove(id);
}

export async function markPulled(id: string): Promise<void> {
  const current = await getStore();
  await current.incrementPulls(id);
}

export function describeCloudError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.toLowerCase();

  if (text.includes("语句被拒绝")) {
    return `公共目录拒绝了这条请求：${raw.replace(/^.*语句被拒绝：/, "")}`;
  }
  if (text.includes("10000") || text.includes("authentication")) {
    return "API Token 无效或权限不足，请检查 Token 是否有 D1 读写权限";
  }
  if (text.includes("7404") || text.includes("database not found")) {
    return "找不到该 D1 数据库，请检查数据库 ID";
  }
  if (text.includes("7403") || text.includes("service authorization")) {
    return "API Token 缺少 D1 权限，请在 Cloudflare 后台补上";
  }
  if (text.includes("7429") || text.includes("overloaded")) {
    return "D1 当前繁忙，请稍后重试";
  }
  if (text.includes("timeout") || text.includes("超时")) {
    return "连接云端存储超时，请检查网络";
  }
  if (text.includes("unable to connect") || text.includes("无法连接")) {
    return "无法连接云端存储，请检查网络或代理设置";
  }
  if (text.includes("exceeded") && text.includes("limit")) {
    return "D1 配额已用尽（免费额度有每日上限），请稍后再试或升级套餐";
  }
  return raw || "未知错误";
}
