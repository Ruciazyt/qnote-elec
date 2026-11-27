import type { Knex } from "knex";
import { log } from "../../system/log";

const SETTINGS_KEY = "gitlab_bot_config";

export interface GitlabBotConfig {
  enabled: boolean;
  port: number;
  bindAddress: string;
  signingToken: string;
  secretToken: string;
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
    bindAddress: "0.0.0.0",
    signingToken: "",
    secretToken: "",
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

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeConfig(raw: any): GitlabBotConfig {
  const fallback = defaultGitlabBotConfig();
  const port = Number(raw?.port);
  const triggerWords = toStringList(raw?.triggerWords);
  return {
    enabled: raw?.enabled === true,
    port:
      Number.isInteger(port) && port > 0 && port < 65536
        ? port
        : fallback.port,
    bindAddress:
      typeof raw?.bindAddress === "string" && raw.bindAddress.trim()
        ? raw.bindAddress.trim()
        : fallback.bindAddress,
    signingToken:
      typeof raw?.signingToken === "string" ? raw.signingToken.trim() : "",
    secretToken:
      typeof raw?.secretToken === "string" ? raw.secretToken : "",
    relayToken:
      typeof raw?.relayToken === "string" ? raw.relayToken.trim() : "",
    triggerWords: triggerWords.length ? triggerWords : fallback.triggerWords,
    allowedProjects: toStringList(raw?.allowedProjects),
    runnerEnabled: raw?.runnerEnabled !== false,
    runnerProject:
      typeof raw?.runnerProject === "string" ? raw.runnerProject.trim() : "",
    runnerTags: toStringList(raw?.runnerTags),
  };
}

export async function loadGitlabBotConfig(): Promise<GitlabBotConfig> {
  if (!db) return cached;
  try {
    const row = await db("settings").where("configName", SETTINGS_KEY).first();
    if (!row?.configValue) {
      cached = defaultGitlabBotConfig();
      return cached;
    }
    cached = normalizeConfig(JSON.parse(row.configValue));
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
  const merged: Record<string, unknown> = { ...cached };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  const next = normalizeConfig(merged);
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
