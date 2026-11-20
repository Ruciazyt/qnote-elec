
import type { Knex } from "knex";
import { log } from "../../main/core/system/log";
import { createLocalSharedStore, type SharedStore } from "./sharedStore";
import { createCatalogSharedStore } from "./catalogStore";
import {
  resolveCatalogDefaults,
  resolveDefaultCatalogConfig,
  sanitizeCatalogConfig,
} from "./defaults";
import type {
  CloudBackend,
  CloudStorageConfig,
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
  const catalog = sanitizeCatalogConfig(obj.catalog);

  let backend: CloudBackend = "local";
  if (obj.backend === "catalog" || obj.backend === "local") {
    backend = obj.backend;
  }

  if (backend === "catalog" && !catalog) {
    log.warn("[cloud] 后端标为 catalog 但公共目录配置不全，按本地处理");
    return { ...fallbackConfig(), catalog: null };
  }

  return { backend, catalog, lastCheck: obj.lastCheck ?? null };
}

function defaultConfig(): CloudStorageConfig {
  const catalog = resolveDefaultCatalogConfig();
  return {
    backend: catalog ? "catalog" : "local",
    catalog,
    lastCheck: null,
  };
}

function fallbackConfig(): CloudStorageConfig {
  return { backend: "local", catalog: null, lastCheck: null };
}

export async function loadCloudConfig(DB: Knex): Promise<CloudStorageConfig> {
  try {
    const row = await DB("settings").where("configName", SETTINGS_KEY).first();
    const raw = row?.configValue;
    return {
      ...parseCloudConfig(typeof raw === "string" ? raw : null),
      catalogDefaults: resolveCatalogDefaults(),
    };
  } catch (error) {
    log.error("[cloud] 读取云端配置失败，按纯本地处理", error);
    return { ...fallbackConfig(), catalogDefaults: resolveCatalogDefaults() };
  }
}

export async function saveCloudConfig(
  DB: Knex,
  config: CloudStorageConfig
): Promise<void> {
  const value = JSON.stringify({
    backend: config.backend,
    catalog: config.catalog,
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
  if (config.backend === "catalog" && config.catalog) {
    return `catalog:${config.catalog.baseUrl}/${config.catalog.appId}`;
  }
  return "local";
}

async function buildStore(
  config: CloudStorageConfig,
  DB: Knex
): Promise<SharedStore> {
  if (config.backend === "catalog" && config.catalog) {
    const { store } = createCatalogSharedStore(config.catalog);
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
