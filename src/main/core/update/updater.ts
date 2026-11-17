import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { log } from "../system/log";
import * as fs from "node:fs";
import * as path from "node:path";


const PORTABLE_MARKER = "portable.marker";

export const RELEASES_PAGE_URL =
  "https://github.com/Ruciazyt/qnote-elec/releases";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
  reason?: string;
}

export const UPDATE_STATUS_CHANNEL = "update:status";

let initialized = false;

let status: UpdateStatus = {
  phase: "idle",
  currentVersion: safeAppVersion(),
};

function safeAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "unknown";
  }
}

function currentStatus(): UpdateStatus {
  return status;
}

function normalizeReleaseNotes(notes: unknown): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    const text = notes
      .map((item) => {
        const entry = item as { version?: string; note?: string };
        const version = entry?.version ? `## v${entry.version}\n` : "";
        return `${version}${entry?.note ?? ""}`.trim();
      })
      .filter(Boolean)
      .join("\n\n");
    return text || undefined;
  }
  return undefined;
}

function isPortableBuild(): boolean {
  if (!app.isPackaged) return false;
  try {
    return fs.existsSync(path.join(process.resourcesPath, PORTABLE_MARKER));
  } catch {
    return false;
  }
}

function broadcast(next: UpdateStatus): void {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(UPDATE_STATUS_CHANNEL, next);
    } catch (err) {
      log.warn("[update] 广播更新状态失败:", err);
    }
  }
}

function patch(partial: Partial<UpdateStatus>): void {
  broadcast({ ...status, ...partial });
}

function humanizeError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (JSON.stringify(err) ?? String(err));
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET/i.test(raw)) {
    return "无法连接更新服务器，请检查网络后重试";
  }
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|Cannot find latest\.yml/i.test(raw)) {
    return "更新源缺少版本信息文件（latest.yml），本次发布可能未正确上传";
  }
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|No published versions/i.test(raw)) {
    return "未找到可用的发布版本";
  }
  if (/404|Not Found/i.test(raw)) {
    return "更新源不可访问（发布仓库可能不是公开的，或尚未创建 Release）";
  }
  return raw || "检查更新失败";
}

export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  if (process.platform === "win32") {
    const verifier = autoUpdater as unknown as {
      verifyUpdateCodeSignature: (
        publisherNames: string[],
        filePath: string
      ) => Promise<string | null>;
    };
    verifier.verifyUpdateCodeSignature = async () => null;
  }

  autoUpdater.logger = {
    info: (message?: any) => log.info("[updater]", message),
    warn: (message?: any) => log.warn("[updater]", message),
    error: (message?: any) => log.error("[updater]", message),
    debug: (message?: string) => log.info("[updater][debug]", message),
  };

  autoUpdater.on("checking-for-update", () => {
    log.info("[update] 开始检查更新");
    patch({ phase: "checking", error: undefined });
  });

  autoUpdater.on("update-available", (info) => {
    log.info("[update] 发现新版本", info?.version);
    patch({
      phase: "available",
      latestVersion: info?.version,
      releaseName: info?.releaseName,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      releaseDate: info?.releaseDate,
      error: undefined,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info("[update] 已是最新版本", info?.version);
    patch({
      phase: "not-available",
      latestVersion: info?.version,
      error: undefined,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    patch({
      phase: "downloading",
      percent: Math.round(progress?.percent ?? 0),
      transferred: progress?.transferred,
      total: progress?.total,
      bytesPerSecond: progress?.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (event) => {
    log.info("[update] 更新包下载完成", event?.version);
    patch({
      phase: "downloaded",
      percent: 100,
      latestVersion: event?.version,
      error: undefined,
    });
  });

  autoUpdater.on("error", (err) => {
    log.error("[update] 更新流程出错:", err);
    patch({ phase: "error", error: humanizeError(err) });
  });
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    patch({
      phase: "unsupported",
      reason: "开发模式无法检查更新，请使用打包版验证",
    });
    return status;
  }

  if (isPortableBuild()) {
    patch({
      phase: "unsupported",
      reason: "便携版不支持自动更新，请前往下载页面手动获取新版本",
    });
    return status;
  }

  if (!autoUpdater.isUpdaterActive()) {
    patch({
      phase: "unsupported",
      reason: "当前构建未启用更新功能",
    });
    return status;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log.error("[update] 检查更新失败:", err);
    if (status.phase === "checking") {
      patch({ phase: "error", error: humanizeError(err) });
    }
  }

  return status;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.phase !== "available") {
    patch({
      phase: "error",
      error: "请先检查更新，确认有新版本后再下载",
    });
    return status;
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log.error("[update] 下载更新失败:", err);
    if (currentStatus().phase !== "error") {
      patch({ phase: "error", error: humanizeError(err) });
    }
  }

  return status;
}

export function installUpdate(): { ok: boolean; error?: string } {
  if (status.phase !== "downloaded") {
    return { ok: false, error: "更新包尚未下载完成" };
  }
  try {
    log.info("[update] 触发重启安装");
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    log.error("[update] 启动安装失败:", err);
    const message = humanizeError(err);
    patch({ phase: "error", error: message });
    return { ok: false, error: message };
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function getUpdateEnvironment(): {
  packaged: boolean;
  portable: boolean;
  releasesUrl: string;
} {
  return {
    packaged: app.isPackaged,
    portable: isPortableBuild(),
    releasesUrl: RELEASES_PAGE_URL,
  };
}
