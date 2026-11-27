import type { Knex } from "knex";
import { log } from "../../../system/log";

const SETTINGS_KEY = "gitlab_bot_config";

export interface GitlabBotConfig {
  enabled: boolean;
  port: number;
  relayToken: string;
  triggerWords: string[];
  allowedProjects: string[];
  runnerEnabled: boolean;
  runnerProject: string;
  runnerTags: string[];
}

export function defaultGitlabBotConfig(): GitlabBotConfig {
  return {
    enabled: false,
    port: 7799,
    relayToken: "",
    triggerWords: ["@qnote"],
    allowedProjects: [],
    runnerEnabled: true,
    runnerProject: "",
    runnerTags: ["qnote"],
  };
}

let db: Knex | null = null;
let cached: GitlabBotConfig = defaultGitlabBotConfig();

export function getGitlabBotConfig(): GitlabBotConfig {
  return cached;
}

function readStoredConfig(raw: Partial<GitlabBotConfig>): GitlabBotConfig {
  const defaults = defaultGitlabBotConfig();
  const config = { ...defaults, ...raw };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    config.port = defaults.port;
  }
  if (!config.triggerWords.length) config.triggerWords = defaults.triggerWords;
  if (!("runnerTags" in raw)) config.runnerTags = [];
  return config;
}

export async function loadGitlabBotConfig(): Promise<GitlabBotConfig> {
  if (!db) return cached;
  try {
    const row = await db("settings").where("configName", SETTINGS_KEY).first();
    if (!row?.configValue) {
      cached = defaultGitlabBotConfig();
      return cached;
    }
    const raw = JSON.parse(row.configValue) as Partial<GitlabBotConfig> &
      Record<string, unknown>;
    const hasLegacyFields =
      "bindAddress" in raw || "signingToken" in raw || "secretToken" in raw;
    delete raw.bindAddress;
    delete raw.signingToken;
    delete raw.secretToken;
    cached = readStoredConfig(raw);
    if (hasLegacyFields) {
      await db("settings")
        .where("configName", SETTINGS_KEY)
        .update({ configValue: JSON.stringify(cached), updated_at: new Date() });
    }
    return cached;
  } catch (err) {
    log.error("[gitlab-bot] 读取配置失败", err);
    return cached;
  }
}

export async function saveGitlabBotConfig(
  patch: Partial<GitlabBotConfig>
): Promise<GitlabBotConfig> {
  if (!db) throw new Error("GitLab Bot 配置存储未初始化");
  const next: GitlabBotConfig = { ...cached, ...patch };
  const now = new Date();
  const value = JSON.stringify(next);
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
  cached = next;
  return next;
}

export async function clearGitlabBotConfig(): Promise<void> {
  if (!db) throw new Error("GitLab Bot 配置存储未初始化");
  await db("settings").where("configName", SETTINGS_KEY).delete();
  cached = defaultGitlabBotConfig();
}

export async function initGitlabBotConfigStore(DB: Knex): Promise<void> {
  db = DB;
  await loadGitlabBotConfig();
}
