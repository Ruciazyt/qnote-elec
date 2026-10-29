import type { Knex } from "knex";
import { log } from "./log";

let settingsDB: Knex | null = null;

const DEFAULT_CHROMA_URL = "local-memory";
const DEFAULT_EMBEDDING_URL = "local-memory";

export function initSettingsStore(DB: Knex) {
  settingsDB = DB;
}

function ensureDB(): Knex {
  if (!settingsDB) {
    throw new Error("Settings store has not been initialized");
  }
  return settingsDB;
}

async function getSetting(configName: string): Promise<string | null> {
  const DB = ensureDB();
  const row = await DB("settings").where("configName", configName).first();
  return row ? (row.configValue as string) : null;
}

async function upsertSetting(configName: string, configValue: string): Promise<void> {
  const DB = ensureDB();
  const exist = await DB("settings").where("configName", configName).first();
  const now = new Date();
  if (exist) {
    await DB("settings").where("configName", configName).update({
      configValue,
      updated_at: now,
    });
  } else {
    await DB("settings").insert({
      configName,
      configValue,
      created_at: now,
      updated_at: now,
    });
  }
}

export async function getVectorStoreConfigFromDB(): Promise<{
  chromaServerUrl: string;
  embeddingServiceUrl: string;
}> {
  try {
    let chroma = await getSetting("chroma_server_url");
    if (chroma === null) {
      await upsertSetting("chroma_server_url", DEFAULT_CHROMA_URL);
      chroma = DEFAULT_CHROMA_URL;
    }

    let embedding = await getSetting("embedding_service_url");
    if (embedding === null) {
      await upsertSetting("embedding_service_url", DEFAULT_EMBEDDING_URL);
      embedding = DEFAULT_EMBEDDING_URL;
    }

    return {
      chromaServerUrl: chroma,
      embeddingServiceUrl: embedding,
    };
  } catch (error) {
    log.error("读取记忆索引配置失败，使用默认值", error);
    return {
      chromaServerUrl: DEFAULT_CHROMA_URL,
      embeddingServiceUrl: DEFAULT_EMBEDDING_URL,
    };
  }
}

export async function saveVectorStoreConfigToDB(
  chromaServerUrl: string,
  embeddingServiceUrl: string
): Promise<void> {
  await upsertSetting("chroma_server_url", chromaServerUrl);
  await upsertSetting("embedding_service_url", embeddingServiceUrl);
  log.info("记忆索引兼容配置已保存到数据库", { chromaServerUrl, embeddingServiceUrl });
}





