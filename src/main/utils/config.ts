import * as fs from "fs";
import * as path from "path";
import type { Knex } from "knex";
import { app } from "electron";
import { log } from "./log";

type Theme = "light" | "dark" | "system";
type AiProvider = "openai" | "deepseek" | "claude";

interface LegacyAppConfig {
  baiduApiKey?: string;
  baiduSecretKey?: string;
  filePath?: string;
  theme?: Theme;
  aiProvider?: AiProvider;
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  voiceHotkey?: string;
  chromaServerUrl?: string;
  embeddingServiceUrl?: string;
}

/**
 * 语音输入的默认全局快捷键
 *
 * 选 F1：它落在功能键区，不与既有快捷键（Ctrl+Shift+V 剪贴板小窗等）冲突，
 * 也不像带修饰键的组合那样容易和别的软件撞键 ——「按一下就开始录音」最不容易
 * 失败的选择。笔记本上 Fn+1 会被驱动映射成 F1，正好对上大多数用户按的物理键。
 * 导出成常量是为了让注册失败时的回滚路径和首次启动共用同一个值。
 */
export const DEFAULT_VOICE_HOTKEY = "F1";

const DEFAULT_CONFIG = {
  baiduApiKey: "",
  baiduSecretKey: "",
  theme: "system",
  aiProvider: "deepseek",
  aiApiKey: "",
  aiModel: "",
  aiBaseUrl: "",
  voiceHotkey: DEFAULT_VOICE_HOTKEY,
  chromaServerUrl: "local-memory",
  embeddingServiceUrl: "local-memory",
};

const SETTINGS_KEYS = {
  BAIDU_API: "baidu_api_key",
  BAIDU_SECRET: "baidu_secret_key",
  AI_PROVIDER: "ai_provider",
  AI_API_KEY: "ai_api_key",
  AI_MODEL: "ai_model",
  AI_BASE_URL: "ai_base_url",
  VOICE_HOTKEY: "voice_hotkey",
  THEME: "theme",
  CHROMA_URL: "chroma_server_url",
  EMBEDDING_URL: "embedding_service_url",
};

class ConfigManager {
  private DB: Knex | null = null;
  private legacyConfigPath: string;
  private legacyChecked = false;
  private migratingLegacy = false;

  constructor() {
    const projectRoot = app.isPackaged
      ? path.dirname(app.getPath("exe"))
      : path.join(__dirname, "..", "..", "..");
    this.legacyConfigPath = path.join(projectRoot, "config.json");
    log.info("Legacy config path:", this.legacyConfigPath);
  }

  initialize(DB: Knex) {
    if (this.DB) {
      return;
    }
    this.DB = DB;
  }

  private async ensureReady(): Promise<Knex> {
    if (!this.DB) {
      throw new Error("ConfigManager has not been initialized");
    }

    if (!this.legacyChecked && !this.migratingLegacy) {
      this.migratingLegacy = true;
      try {
        await this.migrateLegacyConfigIfNeeded();
      } finally {
        this.legacyChecked = true;
        this.migratingLegacy = false;
      }
    }

    return this.DB;
  }

  private async migrateLegacyConfigIfNeeded(): Promise<void> {
    if (!(await this.legacyConfigExists())) {
      return;
    }

    try {
      const raw = await fs.promises.readFile(this.legacyConfigPath, "utf-8");
      const legacy = JSON.parse(raw) as LegacyAppConfig;
      log.info("Detected legacy config.json, migrating to database...");

      await this.writeSettingDirect(SETTINGS_KEYS.BAIDU_API, legacy.baiduApiKey ?? "");
      await this.writeSettingDirect(SETTINGS_KEYS.BAIDU_SECRET, legacy.baiduSecretKey ?? "");
      await this.writeSettingDirect(
        SETTINGS_KEYS.AI_PROVIDER,
        legacy.aiProvider ?? (DEFAULT_CONFIG.aiProvider as string)
      );
      await this.writeSettingDirect(SETTINGS_KEYS.AI_API_KEY, legacy.aiApiKey ?? "");
      await this.writeSettingDirect(SETTINGS_KEYS.AI_MODEL, legacy.aiModel ?? "");
      await this.writeSettingDirect(
        SETTINGS_KEYS.THEME,
        legacy.theme ?? (DEFAULT_CONFIG.theme as string)
      );
      await this.writeSettingDirect(
        SETTINGS_KEYS.CHROMA_URL,
        legacy.chromaServerUrl ?? DEFAULT_CONFIG.chromaServerUrl
      );
      await this.writeSettingDirect(
        SETTINGS_KEYS.EMBEDDING_URL,
        legacy.embeddingServiceUrl ?? DEFAULT_CONFIG.embeddingServiceUrl
      );

      const backupPath = `${this.legacyConfigPath}.migrated.${Date.now()}`;
      await fs.promises.rename(this.legacyConfigPath, backupPath);
      log.info("config.json migrated and renamed to:", backupPath);
    } catch (error) {
      log.error("Failed to migrate legacy config.json", error);
    }
  }

  private async legacyConfigExists(): Promise<boolean> {
    try {
      await fs.promises.access(this.legacyConfigPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async writeSettingDirect(key: string, value: string): Promise<void> {
    if (!this.DB) {
      throw new Error("ConfigManager has not been initialized");
    }
    const now = new Date();
    const exist = await this.DB("settings").where("configName", key).first();
    if (exist) {
      await this.DB("settings").where("configName", key).update({
        configValue: value,
        updated_at: now,
      });
    } else {
      await this.DB("settings").insert({
        configName: key,
        configValue: value,
        created_at: now,
        updated_at: now,
      });
    }
  }

  private async getSetting(key: string, defaultValue = ""): Promise<string> {
    const DB = await this.ensureReady();
    const row = await DB("settings").where("configName", key).first();
    if (row && typeof row.configValue === "string") {
      return row.configValue;
    }

    await this.writeSettingDirect(key, defaultValue);
    return defaultValue;
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    await this.writeSettingDirect(key, value);
  }

  async getBaiduKeys(): Promise<{ apiKey: string; secretKey: string }> {
    const apiKey = await this.getSetting(SETTINGS_KEYS.BAIDU_API, DEFAULT_CONFIG.baiduApiKey);
    const secretKey = await this.getSetting(
      SETTINGS_KEYS.BAIDU_SECRET,
      DEFAULT_CONFIG.baiduSecretKey
    );
    return { apiKey, secretKey };
  }

  async setBaiduKeys(apiKey: string, secretKey: string): Promise<void> {
    await this.upsertSetting(SETTINGS_KEYS.BAIDU_API, apiKey);
    await this.upsertSetting(SETTINGS_KEYS.BAIDU_SECRET, secretKey);
    log.info("Baidu OCR keys stored in database");
  }

  async getAiConfig(): Promise<{ provider: string; apiKey: string; model: string; baseUrl: string }> {
    const provider = await this.getSetting(
      SETTINGS_KEYS.AI_PROVIDER,
      DEFAULT_CONFIG.aiProvider as string
    );
    const apiKey = await this.getSetting(SETTINGS_KEYS.AI_API_KEY, DEFAULT_CONFIG.aiApiKey);
    const model = await this.getSetting(SETTINGS_KEYS.AI_MODEL, DEFAULT_CONFIG.aiModel);
    const baseUrl = await this.getSetting(SETTINGS_KEYS.AI_BASE_URL, DEFAULT_CONFIG.aiBaseUrl);
    return { provider, apiKey, model, baseUrl };
  }

  async setAiConfig(provider: AiProvider, apiKey: string, model: string, baseUrl: string): Promise<void> {
    await this.upsertSetting(SETTINGS_KEYS.AI_PROVIDER, provider ?? (DEFAULT_CONFIG.aiProvider as string));
    await this.upsertSetting(SETTINGS_KEYS.AI_API_KEY, apiKey);
    await this.upsertSetting(SETTINGS_KEYS.AI_MODEL, model);
    await this.upsertSetting(SETTINGS_KEYS.AI_BASE_URL, baseUrl ?? "");
    log.info("AI configuration stored in database", { provider, model });
  }

  /**
   * 语音输入的全局快捷键（Electron accelerator 语法）
   *
   * 存的是「用户想按的那个组合」，是否真能注册由 shortcuts.ts 在运行时判定，
   * 这里不做校验 —— 配置项和系统热键占用状态是两件事，混在一起会让
   * 「改设置」因为别的软件占了键而保存失败。
   */
  async getVoiceHotkey(): Promise<string> {
    return this.getSetting(SETTINGS_KEYS.VOICE_HOTKEY, DEFAULT_CONFIG.voiceHotkey);
  }

  async setVoiceHotkey(accelerator: string): Promise<void> {
    await this.upsertSetting(SETTINGS_KEYS.VOICE_HOTKEY, accelerator);
    log.info("Voice hotkey stored in database", { accelerator });
  }

  async getTheme(): Promise<Theme> {
    const value = await this.getSetting(SETTINGS_KEYS.THEME, DEFAULT_CONFIG.theme as string);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
    return "system";
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.upsertSetting(SETTINGS_KEYS.THEME, theme);
  }

  getConfigPath(): string {
    try {
      fs.accessSync(this.legacyConfigPath, fs.constants.F_OK);
      return this.legacyConfigPath;
    } catch {
      return "存储于数据库 settings 表";
    }
  }

  getDataPath(): string {
    return app.getPath("userData");
  }
}

export const configManager = new ConfigManager();