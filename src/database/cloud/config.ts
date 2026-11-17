import type { Knex } from "knex";
import { log } from "../../main/core/system/log";
import { createLocalSharedStore, type SharedStore } from "./sharedStore";
import { createD1SharedStore, createEndpointSharedStore } from "./d1Store";
import { normalizeEndpoint, resolveDefaultEndpoint } from "./defaults";
import type {
  CloudBackend,
  CloudStorageConfig,
  D1Config,
} from "../../shared/cloud/cloudTypes";


const SETTINGS_KEY = "cloud_storage_config";

export const DEFAULT_CLOUD_CONFIG: CloudStorageConfig = defaultConfig();

export function parseCloudConfig(raw: string | null | undefined): CloudStorageConfig {
  if (!raw) return defaultConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn("[cloud] 云端配置解析失败，退回默认");
    return fallbackConfig();
  }
  if (!parsed || typeof parsed !== "object") {
    return fallbackConfig();
  }

  const obj = parsed as Partial<CloudStorageConfig>;
  const d1 = sanitizeD1Config(obj.d1);
  const endpoint = sanitizeEndpoint(obj.endpoint);

  let backend: CloudBackend = "local";
  if (obj.backend === "d1" || obj.backend === "public" || obj.backend === "local") {
    backend = obj.backend;
  }

  if (backend === "d1" && !d1) {
    log.warn("[cloud] 后端标为 d1 但 D1 配置不全，按本地处理");
    return { ...fallbackConfig(), d1: null, endpoint };
  }

  if (backend === "public" && !endpoint) {
    log.warn("[cloud] 后端标为 public 但没有公共目录地址，按本地处理");
    return { ...fallbackConfig(), d1, endpoint: null };
  }

  return { backend, d1, endpoint, lastCheck: obj.lastCheck ?? null };
}

function defaultConfig(): CloudStorageConfig {
  const endpoint = resolveDefaultEndpoint();
  return {
    backend: endpoint ? "public" : "local",
    d1: null,
    endpoint: endpoint || null,
    lastCheck: null,
  };
}

function fallbackConfig(): CloudStorageConfig {
  return { backend: "local", d1: null, endpoint: null, lastCheck: null };
}

function sanitizeD1Config(input: unknown): D1Config | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Partial<D1Config>;
  const accountId = typeof obj.accountId === "string" ? obj.accountId.trim() : "";
  const databaseId = typeof obj.databaseId === "string" ? obj.databaseId.trim() : "";
  const apiToken = typeof obj.apiToken === "string" ? obj.apiToken.trim() : "";
  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken };
}

function sanitizeEndpoint(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = normalizeEndpoint(input);
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export async function loadCloudConfig(DB: Knex): Promise<CloudStorageConfig> {
  try {
    const row = await DB("settings").where("configName", SETTINGS_KEY).first();
    const raw = row?.configValue;
    return parseCloudConfig(typeof raw === "string" ? raw : null);
  } catch (error) {
    log.error("[cloud] 读取云端配置失败，按纯本地处理", error);
    return fallbackConfig();
  }
}

export async function saveCloudConfig(
  DB: Knex,
  config: CloudStorageConfig
): Promise<void> {
  const value = JSON.stringify({
    backend: config.backend,
    d1: config.d1,
    endpoint: config.endpoint,
    lastCheck: config.lastCheck ?? null,
  });
  const existing = await DB("settings").where("configName", SETTINGS_KEY).first();
  const now = new Date();
  if (existing) {
    await DB("settings")
      .where("configName", SETTINGS_KEY)
      .update({ configValue: value, updated_at: now });
  } else {
    await DB("settings").insert({
      configName: SETTINGS_KEY,
      configValue: value,
      created_at: now,
      updated_at: now,
    });
  }
}

let activeStore: SharedStore | null = null;
let activeStoreKey = "";

export async function getSharedStore(DB: Knex): Promise<SharedStore> {
  const config = await loadCloudConfig(DB);
  const key = storeKey(config);

  if (activeStore && activeStoreKey === key) {
    return activeStore;
  }

  const store = await buildStore(config, DB);
  activeStore = store;
  activeStoreKey = key;
  return store;
}

export async function resetSharedStore(): Promise<void> {
  activeStore = null;
  activeStoreKey = "";
}

function storeKey(config: CloudStorageConfig): string {
  if (config.backend === "d1" && config.d1) {
    return `d1:${config.d1.accountId}:${config.d1.databaseId}`;
  }
  if (config.backend === "public" && config.endpoint) {
    return `public:${config.endpoint}`;
  }
  return "local";
}

async function buildStore(
  config: CloudStorageConfig,
  DB: Knex
): Promise<SharedStore> {
  if (config.backend === "d1" && config.d1) {
    const { store } = createD1SharedStore(config.d1);
    try {
      await store.init();
      return store;
    } catch (error) {
      log.error("[cloud] D1 初始化失败，本次退回本地共享存储", error);
      const local = createLocalSharedStore(DB);
      await local.init();
      return local;
    }
  }

  if (config.backend === "public" && config.endpoint) {
    const { store } = createEndpointSharedStore(config.endpoint);
    try {
      await store.init();
      return store;
    } catch (error) {
      log.error("[cloud] 公共目录初始化失败，本次退回本地共享存储", error);
      const local = createLocalSharedStore(DB);
      await local.init();
      return local;
    }
  }

  const local = createLocalSharedStore(DB);
  await local.init();
  return local;
}
