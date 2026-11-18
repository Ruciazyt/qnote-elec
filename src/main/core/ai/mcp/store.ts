import type { Knex } from "knex";
import { log } from "../../system/log";
import type { McpServerConfig } from "./types";

const SETTINGS_KEY = "mcp_servers";
const PROJECT_DIR_KEY = "mcp_project_dir";

let db: Knex | null = null;

export function initMcpStore(DB: Knex): void {
  db = DB;
}

export async function loadMcpServerConfigs(): Promise<McpServerConfig[]> {
  if (!db) return [];
  try {
    const row = await db("settings").where("configName", SETTINGS_KEY).first();
    if (!row || !row.configValue) return [];
    const parsed = JSON.parse(row.configValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: any) => item && typeof item.id === "string" && typeof item.name === "string"
    );
  } catch (err) {
    log.error("[mcp] 读取服务器配置失败", err);
    return [];
  }
}

export async function saveMcpServerConfigs(list: McpServerConfig[]): Promise<void> {
  if (!db) throw new Error("MCP 存储未初始化");
  const now = new Date();
  const value = JSON.stringify(list);
  const exist = await db("settings").where("configName", SETTINGS_KEY).first();
  if (exist) {
    await db("settings")
      .where("configName", SETTINGS_KEY)
      .update({ configValue: value, updated_at: now });
    return;
  }
  await db("settings").insert({
    configName: SETTINGS_KEY,
    configValue: value,
    created_at: now,
    updated_at: now,
  });
}

export async function loadMcpProjectDir(): Promise<string | null> {
  if (!db) return null;
  try {
    const row = await db("settings").where("configName", PROJECT_DIR_KEY).first();
    if (!row || typeof row.configValue !== "string") return null;
    const trimmed = row.configValue.trim();
    return trimmed ? trimmed : null;
  } catch (err) {
    log.error("[mcp] 读取项目配置目录失败", err);
    return null;
  }
}

export async function saveMcpProjectDir(dir: string | null): Promise<void> {
  if (!db) throw new Error("MCP 存储未初始化");
  const now = new Date();
  const value = dir ? dir.trim() : "";
  const exist = await db("settings").where("configName", PROJECT_DIR_KEY).first();
  if (exist) {
    await db("settings")
      .where("configName", PROJECT_DIR_KEY)
      .update({ configValue: value, updated_at: now });
    return;
  }
  await db("settings").insert({
    configName: PROJECT_DIR_KEY,
    configValue: value,
    created_at: now,
    updated_at: now,
  });
}
