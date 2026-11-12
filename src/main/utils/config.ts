import * as fs from "fs";
import * as path from "path";
import type { Knex } from "knex";
import { app } from "electron";
import { log } from "./log";
import {
  DEFAULT_CLIPBOARD_PANEL_POSITION,
  isClipboardPanelPosition,
  type ClipboardPanelPosition,
} from "../../shared/clipboardPanel";
import {
  DEFAULT_ISLAND_SETTINGS,
  ISLAND_HOVER_DELAY_MAX,
  ISLAND_HOVER_DELAY_MIN,
  type IslandExpandTrigger,
  type IslandSettings,
} from "../../shared/island";

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
 * 选 F1：它落在功能键区，不与其它全局快捷键（Ctrl+Shift+C 剪贴板面板、
 * Ctrl+Enter 唤出主窗口）冲突，也不像带修饰键的组合那样容易和别的软件撞键 ——
 * 「按一下就开始录音」最不容易失败的选择。笔记本上 Fn+1 会被驱动映射成 F1，
 * 正好对上大多数用户按的物理键。
 * 导出成常量是为了让注册失败时的回滚路径和首次启动共用同一个值。
 */
export const DEFAULT_VOICE_HOTKEY = "F1";

/**
 * 剪贴板面板的默认全局快捷键
 *
 * 选 Ctrl+Shift+C 的理由：
 *   - 不跟系统保留键冲突（Win+C 在 Windows 11 上被 Copilot 占了）
 *   - 三个平台写法一致，不用在 macOS 上退让（macOS 的 Command+C 是全系统复制，
 *     抢不得）
 *   - 不是任何 Windows 资源管理器级别的键（F2 改名、F3 搜索都被系统用了，
 *     全局注册会把它们从资源管理器手里抢走）
 *
 * 用户可以在设置页改成任意可用组合；改不动的话托盘菜单里也有「剪贴板面板」兜底。
 */
export const DEFAULT_CLIPBOARD_PANEL_HOTKEY = "Control+Shift+C";

const DEFAULT_CONFIG = {
  baiduApiKey: "",
  baiduSecretKey: "",
  theme: "system",
  aiProvider: "deepseek",
  aiApiKey: "",
  aiModel: "",
  aiBaseUrl: "",
  voiceHotkey: DEFAULT_VOICE_HOTKEY,
  clipboardPanelHotkey: DEFAULT_CLIPBOARD_PANEL_HOTKEY,
  clipboardPanelPosition: DEFAULT_CLIPBOARD_PANEL_POSITION,
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
  CLIPBOARD_PANEL_HOTKEY: "clipboard_panel_hotkey",
  CLIPBOARD_PANEL_POSITION: "clipboard_panel_position",
  THEME: "theme",
  CHROMA_URL: "chroma_server_url",
  EMBEDDING_URL: "embedding_service_url",
  ISLAND: "island_settings",
};

/**
 * 逐字段校验灵动岛配置
 *
 * 这份数据直接决定窗口坐标和尺寸 —— 非法值不能透给调用方。
 *
 * 位置两种模式都要留：贴顶时纵向会被拉回工作区上沿，
 * 横向保留用户放的地方 —— 清掉的话每次吸顶都要弹回正中，
 * 岛就成了「只能固定在中间」。
 */
function sanitizeIslandSettings(input: Partial<IslandSettings>): IslandSettings {
  const trigger: IslandExpandTrigger =
    input.expandTrigger === "hover" ? "hover" : DEFAULT_ISLAND_SETTINGS.expandTrigger;

  const rawDelay = typeof input.hoverDelayMs === "number" ? input.hoverDelayMs : NaN;
  const hoverDelayMs = Number.isFinite(rawDelay)
    ? Math.round(Math.min(ISLAND_HOVER_DELAY_MAX, Math.max(ISLAND_HOVER_DELAY_MIN, rawDelay)))
    : DEFAULT_ISLAND_SETTINGS.hoverDelayMs;

  const attachMode = input.attachMode === "floating" ? "floating" : "attached";

  const position =
    input.position && Number.isFinite(input.position.x) && Number.isFinite(input.position.y)
      ? { x: Math.round(input.position.x), y: Math.round(input.position.y) }
      : null;

  const displayId =
    typeof input.displayId === "number" && Number.isFinite(input.displayId)
      ? Math.round(input.displayId)
      : null;

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_ISLAND_SETTINGS.enabled,
    expandTrigger: trigger,
    hoverDelayMs,
    attachMode,
    position,
    displayId,
  };
}

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

  /**
   * 剪贴板面板的全局快捷键（Electron accelerator 语法）
   *
   * 存的是「用户想按的那个组合」，能不能真注册由 shortcuts.ts 在运行时判定。
   */
  async getClipboardPanelHotkey(): Promise<string> {
    return this.getSetting(
      SETTINGS_KEYS.CLIPBOARD_PANEL_HOTKEY,
      DEFAULT_CONFIG.clipboardPanelHotkey
    );
  }

  async setClipboardPanelHotkey(accelerator: string): Promise<void> {
    await this.upsertSetting(SETTINGS_KEYS.CLIPBOARD_PANEL_HOTKEY, accelerator);
    log.info("剪贴板面板快捷键已保存", { accelerator });
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

  /**
   * 剪贴板面板的展示位置（底部横排 / 侧边竖排）
   *
   * 读出来的一定是合法值：库里存了脏数据就退回默认值，
   * 绝不把非法值透给调用方 —— 这个值直接决定窗口坐标和尺寸。
   */
  async getClipboardPanelPosition(): Promise<ClipboardPanelPosition> {
    const value = await this.getSetting(
      SETTINGS_KEYS.CLIPBOARD_PANEL_POSITION,
      DEFAULT_CONFIG.clipboardPanelPosition
    );
    return isClipboardPanelPosition(value) ? value : DEFAULT_CONFIG.clipboardPanelPosition;
  }

  async setClipboardPanelPosition(position: ClipboardPanelPosition): Promise<void> {
    if (!isClipboardPanelPosition(position)) {
      throw new Error(`无效的剪贴板面板位置: ${position}`);
    }
    await this.upsertSetting(SETTINGS_KEYS.CLIPBOARD_PANEL_POSITION, position);
    log.info("剪贴板面板位置已保存", { position });
  }

  /**
   * 灵动岛配置
   *
   * 存成一整份 JSON，而不是拆成好几个 setting key ——
   * 岛的位置（x/y）和贴顶模式是配套的，分开存会出现
   * 「模式是浮着、位置是 null」这种自相矛盾的组合。
   *
   * 读出来时逐字段校验：这份数据决定窗口坐标和尺寸，
   * 脏数据透给调用方会直接把窗口摆到屏幕外面去。
   */
  async getIslandSettings(): Promise<IslandSettings> {
    const raw = await this.getSetting(SETTINGS_KEYS.ISLAND, "");
    if (!raw) {
      return { ...DEFAULT_ISLAND_SETTINGS };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<IslandSettings>;
      return sanitizeIslandSettings(parsed);
    } catch (err) {
      log.warn("[island] 灵动岛配置解析失败，回退默认值", err);
      return { ...DEFAULT_ISLAND_SETTINGS };
    }
  }

  /** 合并式更新灵动岛配置，返回落库后的完整配置 */
  async setIslandSettings(patch: Partial<IslandSettings>): Promise<IslandSettings> {
    const current = await this.getIslandSettings();
    const next = sanitizeIslandSettings({ ...current, ...patch });
    await this.upsertSetting(SETTINGS_KEYS.ISLAND, JSON.stringify(next));
    log.info("[island] 灵动岛配置已保存", {
      enabled: next.enabled,
      expandTrigger: next.expandTrigger,
      attachMode: next.attachMode,
    });
    return next;
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