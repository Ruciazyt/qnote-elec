import type { Knex } from "knex";
import { log } from "../../../../system/log";
import { setGitlabRuntimeConfig } from "./runtime";

const SETTINGS_KEY = "gitlab_config";

export interface StoredGitlabConfig {
  baseUrl: string;
  token: string;
  allowedProjects: string[];
  readOnly: boolean;
  expectedVersion: string | null;
}

let db: Knex | null = null;

export async function loadGitlabConfig(): Promise<StoredGitlabConfig | null> {
  if (!db) return null;
  try {
    const row = await db("settings").where("configName", SETTINGS_KEY).first();
    if (!row?.configValue) return null;
    const parsed = JSON.parse(row.configValue);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
      allowedProjects: Array.isArray(parsed.allowedProjects)
        ? parsed.allowedProjects.filter((item) => typeof item === "string")
        : [],
      readOnly: parsed.readOnly === true,
      expectedVersion:
        typeof parsed.expectedVersion === "string" ? parsed.expectedVersion : null,
    };
  } catch (err) {
    log.error("[gitlab] 读取配置失败", err);
    return null;
  }
}

export async function saveGitlabConfig(config: StoredGitlabConfig): Promise<void> {
  if (!db) throw new Error("GitLab 配置存储未初始化");
  const now = new Date();
  const value = JSON.stringify(config);
  const exist = await db("settings").where("configName", SETTINGS_KEY).first();
  if (exist) {
    await db("settings")
      .where("configName", SETTINGS_KEY)
      .update({ configValue: value, updated_at: now });
  } else {
    await db("settings").insert({
      configName: SETTINGS_KEY,
      configValue: value,
      created_at: now,
      updated_at: now,
    });
  }
  applyGitlabConfig(config);
}

export async function clearGitlabConfig(): Promise<void> {
  if (!db) throw new Error("GitLab 配置存储未初始化");
  setGitlabRuntimeConfig(undefined);
  await db("settings").where("configName", SETTINGS_KEY).delete();
}

export function applyGitlabConfig(config: StoredGitlabConfig): void {
  setGitlabRuntimeConfig({
    baseUrl: config.baseUrl,
    token: config.token,
    allowedProjects: config.allowedProjects,
    readOnly: config.readOnly,
    expectedVersion: config.expectedVersion,
    maxResultTokens: 4000,
    requestTimeoutMs: 30000,
  });
}

export async function initGitlabConfigStore(DB: Knex): Promise<void> {
  db = DB;
  const stored = await loadGitlabConfig();
  if (stored) applyGitlabConfig(stored);
}
