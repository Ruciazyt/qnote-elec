
import type { Knex } from "knex";
import { log } from "../../main/core/system/log";
import {
  DEFAULT_CLOUD_CONFIG,
  getSharedStore,
  loadCloudConfig,
  resetSharedStore,
  saveCloudConfig,
} from "./config";
import { createCatalogSharedStore } from "./catalogStore";
import { CatalogError } from "./catalogClient";
import { sanitizeCatalogConfig } from "./defaults";
import type { SharedStore } from "./sharedStore";
import type {
  CatalogConfig,
  CloudBackend,
  CloudConnectionStatus,
  CloudStorageConfig,
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
  catalog?: CatalogConfig | null;
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
    catalog:
      input.catalog === undefined
        ? current.catalog
        : sanitizeCatalogConfig(input.catalog),
    lastCheck: null,
  };

  if (next.backend === "catalog") {
    if (!next.catalog) {
      return {
        ok: false,
        error: "切换到公共目录前请先填好站点地址、App ID 与 API Key",
        config: current,
      };
    }
    const status = await checkCatalog(next.catalog);
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

export async function checkCatalog(
  config: CatalogConfig
): Promise<CloudConnectionStatus> {
  const sanitized = sanitizeCatalogConfig(config);
  if (!sanitized) {
    return {
      ok: false,
      error: "公共目录的站点地址、App ID、Public Key 与 Private Key 要填全",
    };
  }
  try {
    const { store: catalogStore } = createCatalogSharedStore(sanitized);
    const result = await catalogStore.check();
    if (!result.ok) {
      return { ok: false, error: result.error ?? "公共目录不可用" };
    }
    return {
      ok: true,
      tableCount: 1,
      detail: result.detail ?? "已连接公共目录",
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
  if (error instanceof CatalogError) {
    const status = error.status;
    const text = error.message.toLowerCase();

    if (status === 401) {
      return "公共目录拒绝了这次认证，请检查 API Key";
    }
    if (status === 403) {
      return "这个 API Key 没有访问该端点的权限";
    }
    if (status === 404) {
      return "公共目录里找不到这个端点，请检查 App ID 与端点路径";
    }
    if (status === 405) {
      return "公共目录不支持这个请求方法";
    }
    if (status === 408) {
      return "公共目录执行超时，请稍后重试";
    }
    if (status === 429) {
      return "公共目录请求过于频繁，请稍后重试";
    }
    if (status !== undefined && status >= 500) {
      return `公共目录服务端出错（HTTP ${status}），请稍后重试`;
    }
    if (error.code === 1146 || text.includes("table not found")) {
      return "公共目录里的 published_app 表还没建好";
    }
    if (text.includes("param check failed")) {
      return "公共目录端点的参数对不上，请检查端点定义";
    }
    if (text.includes("timeout") || text.includes("超时")) {
      return "连接公共目录超时，请检查网络";
    }
    if (
      text.includes("fetch failed") ||
      text.includes("unable to connect") ||
      text.includes("连不上")
    ) {
      return "连不上公共目录，请检查站点地址与网络";
    }
    return error.message || "未知错误";
  }

  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw || "未知错误";
}
