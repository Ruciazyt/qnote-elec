import type { Knex } from "knex";
import { log } from "../../system/log";

const SETTINGS_KEY = "disabled_ai_tools";

let db: Knex | null = null;
const disabled = new Set<string>();

export async function initToolToggleStore(DB: Knex): Promise<void> {
  db = DB;
  disabled.clear();
  try {
    const row = await db("settings").where("configName", SETTINGS_KEY).first();
    const raw = row?.configValue;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (typeof item === "string" && item) disabled.add(item);
    }
  } catch (err) {
    log.error("[tools] 读取工具开关失败", err);
  }
}

export function isToolEnabled(name: string): boolean {
  return !disabled.has(name);
}

export function getDisabledToolNames(): string[] {
  return [...disabled];
}

export async function setToolEnabled(name: string, enabled: boolean): Promise<void> {
  if (!db) throw new Error("工具存储未初始化");
  if (enabled) disabled.delete(name);
  else disabled.add(name);

  const now = new Date();
  const value = JSON.stringify([...disabled]);
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
