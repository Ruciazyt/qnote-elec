import type { Knex } from "knex";
import { log } from "../../main/utils/log";
import { createLocalSharedStore, type SharedStore } from "./sharedStore";
import { createD1SharedStore, createEndpointSharedStore } from "./d1Store";
import { normalizeEndpoint, resolveDefaultEndpoint } from "./defaults";
import type {
  CloudBackend,
  CloudStorageConfig,
  D1Config,
} from "../../shared/cloudTypes";

/**
 * 云端存储的配置与切换
 *
 * ## 配置存哪
 *
 * 存**本地** SQLite 的 `settings` 表。这看着别扭 —— 明明是「云端」的配置，
 * 却存本地 —— 但这是必须的：配置决定了「用哪个后端」，
 * 如果配置本身在云端，那就是先鸡后蛋（要先连上云端才能知道连哪个云端）。
 * 而本地库是一定在的（私有数据都在那儿），所以读配置永远读得到。
 *
 * ## 三种后端
 *
 * | backend | 连什么 | 用户要做什么 |
 * | --- | --- | --- |
 * | `local` | 本地 SQLite 的 published_app 表 | 什么都不用做 |
 * | `d1` | 直连 Cloudflare D1 REST | 填账号 ID / 库 ID / Token |
 * | `public` | 公共目录 Worker 代理 | 什么都不用做（地址已内置） |
 *
 * `public` 是「所有用户零配置」的那一档 —— 它不需要任何凭据，
 * 凭据在 Worker 那边。客户端只内置一个公开地址。
 *
 * ## 密钥不进仓库
 *
 * 直连 D1 用的 API Token 由用户在设置页填，运行时注入到内存，
 * 跟着本项目的其它密钥（百度 OCR、AI API Key）走同一条路 ——
 * 见 AGENTS.md 第 4 节。
 */

const SETTINGS_KEY = "cloud_storage_config";

/** 默认配置 —— 没配过时的样子 */
export const DEFAULT_CLOUD_CONFIG: CloudStorageConfig = {
  backend: "local",
  d1: null,
  endpoint: null,
  lastCheck: null,
};

/**
 * 把存盘的那一串 JSON 解析成配置对象
 *
 * 解析失败不能抛 —— 配置坏了应该退回默认（纯本地），
 * 而不是让整个应用起不来。坏掉的那份原样留着，
 * 用户在设置页看一眼就知道要重新填。
 */
export function parseCloudConfig(raw: string | null | undefined): CloudStorageConfig {
  if (!raw) return defaultConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn("[cloud] 云端配置解析失败，退回默认");
    return defaultConfig();
  }
  if (!parsed || typeof parsed !== "object") {
    return defaultConfig();
  }

  const obj = parsed as Partial<CloudStorageConfig>;
  const d1 = sanitizeD1Config(obj.d1);
  const endpoint = sanitizeEndpoint(obj.endpoint);

  let backend: CloudBackend = "local";
  if (obj.backend === "d1" || obj.backend === "public" || obj.backend === "local") {
    backend = obj.backend;
  }

  // 后端写着 d1 但没配全 —— 按 local 处理
  // 配置不全就去连云端，注定失败，不如直接退回本地
  if (backend === "d1" && !d1) {
    log.warn("[cloud] 后端标为 d1 但 D1 配置不全，按本地处理");
    return { ...defaultConfig(), d1: null, endpoint };
  }

  // 后端写着 public 但没有地址 —— 退回 local
  if (backend === "public" && !endpoint) {
    log.warn("[cloud] 后端标为 public 但没有公共目录地址，按本地处理");
    return { ...defaultConfig(), d1, endpoint: null };
  }

  return { backend, d1, endpoint, lastCheck: obj.lastCheck ?? null };
}

/**
 * 默认配置
 *
 * 有内置的公共目录地址时，默认就用它 —— 这就是「所有用户零配置」的落点：
 * 装上就能用，不需要填任何东西。
 */
function defaultConfig(): CloudStorageConfig {
  const endpoint = resolveDefaultEndpoint();
  return {
    backend: endpoint ? "public" : "local",
    d1: null,
    endpoint: endpoint || null,
    lastCheck: null,
  };
}

/** 挑出 D1 配置里的有效字段 —— 三个都要非空字符串 */
function sanitizeD1Config(input: unknown): D1Config | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Partial<D1Config>;
  const accountId = typeof obj.accountId === "string" ? obj.accountId.trim() : "";
  const databaseId = typeof obj.databaseId === "string" ? obj.databaseId.trim() : "";
  const apiToken = typeof obj.apiToken === "string" ? obj.apiToken.trim() : "";
  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken };
}

/** 挑出公共目录地址 */
function sanitizeEndpoint(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = normalizeEndpoint(input);
  if (!trimmed) return null;
  // 只认 http(s) —— 别的协议（比如 file:）不该被当成云端地址
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/** 从本地库读配置 */
export async function loadCloudConfig(DB: Knex): Promise<CloudStorageConfig> {
  try {
    const row = await DB("settings").where("configName", SETTINGS_KEY).first();
    const raw = row?.configValue;
    return parseCloudConfig(typeof raw === "string" ? raw : null);
  } catch (error) {
    log.error("[cloud] 读取云端配置失败，按纯本地处理", error);
    return defaultConfig();
  }
}

/** 把配置写回本地库 */
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

/**
 * 当前生效的共享存储
 *
 * 启动时建一次，之后一直复用 —— 共享存储的建表 / 连通性检查
 * 都是网络往返，不该每次查询都重连。
 */
let activeStore: SharedStore | null = null;
let activeStoreKey = "";

/**
 * 拿到（必要时重建）当前共享存储
 *
 * @param DB 本地库 —— local 后端要用它建表
 */
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

/** 配置变了就换一份 —— 设置页改完调用它 */
export async function resetSharedStore(): Promise<void> {
  activeStore = null;
  activeStoreKey = "";
}

/** 配置的指纹 —— 变了就说明要重建 */
function storeKey(config: CloudStorageConfig): string {
  if (config.backend === "d1" && config.d1) {
    return `d1:${config.d1.accountId}:${config.d1.databaseId}`;
  }
  if (config.backend === "public" && config.endpoint) {
    return `public:${config.endpoint}`;
  }
  return "local";
}

/** 按配置建一份共享存储 */
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
      // 云端建表失败 —— 退回本地，别让应用因为云端不可用而起不来
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
