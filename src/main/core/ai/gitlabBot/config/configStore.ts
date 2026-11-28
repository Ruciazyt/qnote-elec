import type { Knex } from "knex";
import { log } from "../../../system/log";
import { GITLAB_RUNNER_DEFAULT_TAGS } from "../../../../../shared/ai/gitlabBot";

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
    runnerTags: [...GITLAB_RUNNER_DEFAULT_TAGS],
  };
}

let db: Knex | null = null;
let cached: GitlabBotConfig = defaultGitlabBotConfig();

export function getGitlabBotConfig(): GitlabBotConfig {
  return cached;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const list = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return list.length ? list : [...fallback];
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readStoredConfig(raw: Partial<GitlabBotConfig>): GitlabBotConfig {
  const defaults = defaultGitlabBotConfig();
  const port = raw.port;
  return {
    enabled: boolValue(raw.enabled, defaults.enabled),
    port:
      typeof port === "number" &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535
        ? port
        : defaults.port,
    relayToken: textValue(raw.relayToken, defaults.relayToken),
    triggerWords: stringList(raw.triggerWords, defaults.triggerWords),
    allowedProjects: stringList(raw.allowedProjects, defaults.allowedProjects),
    runnerEnabled: boolValue(raw.runnerEnabled, defaults.runnerEnabled),
    runnerProject: textValue(raw.runnerProject, defaults.runnerProject),
    runnerTags: stringList(raw.runnerTags, defaults.runnerTags),
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
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<GitlabBotConfig>;
  const next = readStoredConfig({ ...cached, ...defined });
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
