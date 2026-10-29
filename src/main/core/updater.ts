import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { log } from "../utils/log";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// 应用更新服务
//
// 用 electron-updater 对接 GitHub Releases。选它而不是自己写下载器，是因为
// 它把三件容易写错的事都做完了：
//   1. 读 Release 里的 latest.yml 拿到版本号与安装包文件名；
//   2. 下载时校验 SHA512（latest.yml 里的 sha512 字段），防止下载到损坏/被
//      篡改的安装包；
//   3. 下载完后调 NSIS 安装器完成"关掉旧版本 → 覆盖安装 → 拉起新版本"，
//      这一步自己实现要处理进程占用、文件锁、静默安装参数等一堆细节。
//
// 更新源的配置来自 build/electron-builder.json 的 publish 段，electron-builder
// 在打包时把它写成 resources/app-update.yml，运行时由本模块自动读取。
// ---------------------------------------------------------------------------

/** 便携版标记文件名 — 由 scripts/build/post-build.js 写进便携版压缩包 */
const PORTABLE_MARKER = "portable.marker";

/** 打开 Releases 页面的地址 — 自动更新不可用时的兜底出口 */
export const RELEASES_PAGE_URL =
  "https://github.com/Ruciazyt/qnote-elec/releases";

/**
 * 更新流程的状态机
 *
 * 用单一状态对象而不是若干个布尔量，是因为渲染层要按状态决定按钮文案与
 * 可用性（"检查更新" / "下载更新" / "重启安装" 三者互斥），散落的布尔量
 * 迟早会出现"两个按钮同时可点"的组合。
 */
export type UpdatePhase =
  /** 还没查过 */
  | "idle"
  /** 正在检查 */
  | "checking"
  /** 有新版本可下载 */
  | "available"
  /** 已是最新 */
  | "not-available"
  /** 正在下载 */
  | "downloading"
  /** 下载完成，等待安装 */
  | "downloaded"
  /** 出错了 */
  | "error"
  /** 当前运行环境不支持自动更新（开发模式 / 便携版） */
  | "unsupported";

export interface UpdateStatus {
  phase: UpdatePhase;
  /** 当前运行中的版本 */
  currentVersion: string;
  /** 线上最新版本 */
  latestVersion?: string;
  /** Release 标题 */
  releaseName?: string;
  /** 更新说明（Markdown 原文） */
  releaseNotes?: string;
  /** 发布时间 */
  releaseDate?: string;
  /** 下载进度 0~100 */
  percent?: number;
  /** 已下载字节 */
  transferred?: number;
  /** 总字节 */
  total?: number;
  /** 速度（字节/秒） */
  bytesPerSecond?: number;
  /** 错误信息（面向用户的中文描述） */
  error?: string;
  /** phase=unsupported 时的原因说明 */
  reason?: string;
}

/** 状态变化时广播给渲染层的通道 */
export const UPDATE_STATUS_CHANNEL = "update:status";

let initialized = false;

/**
 * 当前状态
 *
 * 初始值在模块加载时构造 —— 此时 app.getVersion() 已经可用（它只读
 * package.json，不依赖 app ready），而 initUpdater() 要等到 app ready
 * 之后才调用。渲染层先拿到 idle 状态，再由事件推进。
 */
let status: UpdateStatus = {
  phase: "idle",
  currentVersion: safeAppVersion(),
};

/** 取当前版本号；极端情况下 app 尚未初始化完时退化为 unknown */
function safeAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "unknown";
  }
}

/**
 * 读取当前状态快照
 *
 * 刻意用函数而不是直接读模块级的 status：status 会被事件回调改写，
 * 而 TypeScript 对模块级 let 的窄化在同一个函数内是"过期"的 ——
 * 读一次 status.phase 之后，TS 会认定它后面不会变，于是把
 * `status.phase !== "error"` 判成恒真并报错。走函数取就能拿到实时值。
 */
function currentStatus(): UpdateStatus {
  return status;
}

/**
 * 把更新说明规整成纯文本
 *
 * electron-updater 给出的 releaseNotes 可能是字符串，也可能是
 * [{version, note}] 数组（开了 fullChangelog 时）。渲染层只认字符串，
 * 这里统一拍平成带版本小标题的 Markdown 文本。
 */
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

/**
 * 判断当前是不是便携版
 *
 * 便携版是 win-unpacked 整个目录压成 zip，用户解压到任意位置直接跑。
 * 它没有安装器，也就无法"覆盖安装自己"——NSIS 安装器只会把新版本装到
 * 程序目录去，用户的便携目录还是旧的。因此便携版必须关闭自动更新，
 * 改成引导用户去 Releases 页面手动下载。
 *
 * 标记文件由 scripts/build/post-build.js 在压缩前写进 win-unpacked/resources。
 * 之所以不靠"路径里有没有 Programs"之类的特征判断，是因为用户可以装到
 * 任意目录，靠路径猜会误伤正常安装版。
 */
function isPortableBuild(): boolean {
  if (!app.isPackaged) return false;
  try {
    return fs.existsSync(path.join(process.resourcesPath, PORTABLE_MARKER));
  } catch {
    return false;
  }
}

/** 把新状态推给所有窗口 */
function broadcast(next: UpdateStatus): void {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(UPDATE_STATUS_CHANNEL, next);
    } catch (err) {
      // 窗口可能正在销毁，广播失败不影响主流程
      log.warn("[update] 广播更新状态失败:", err);
    }
  }
}

/** 合并部分字段并广播 */
function patch(partial: Partial<UpdateStatus>): void {
  broadcast({ ...status, ...partial });
}

/**
 * 把 electron-updater 的内部错误翻译成用户看得懂的一句话
 *
 * 直接把英文原始错误抛给用户没有意义。这里只区分几类真正影响用户下一步
 * 动作的情况，其余统一给一个"网络或发布源不可用"的概括。
 */
function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
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

/**
 * 初始化更新器 —— 必须在 app ready 之后调用
 *
 * 事件监听只在这里注册一次。重复注册会让同一次更新广播多次，
 * 渲染层的进度条会开始乱跳。
 */
export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

  // 手动触发下载：默认的自动下载会在用户没同意时就开始占用带宽，
  // 而且下载完也不告诉用户，行为不可预期。
  autoUpdater.autoDownload = false;
  // 不在退出应用时自动安装更新。
  //
  // 这一条是给企业安全扫描看的：`autoInstallOnAppQuit` 打开时，用户只是
  // 关掉应用，下载好的安装包就会在后台**静默**执行 —— 从临时目录里拉起
  // 一个没有受信任签名的 exe，正是 EDR 最敏感的行为模式（无界面执行 +
  // 可执行文件来自下载/缓存目录）。不少企业策略会直接拦下来，用户看到的
  // 就是「应用退出一半被安全软件阻止」。
  //
  // 改成必须由用户点「重启并安装」才会安装，行为可预期，也不会踩这条规则。
  autoUpdater.autoInstallOnAppQuit = false;

  // electron-updater 默认用 console 输出日志，进了打包版就什么都看不到。
  // 接到应用自己的日志系统里，报障时能直接看 app.log。
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

/**
 * 检查更新
 *
 * 返回当前状态快照，渲染层据此更新界面。真正的结果通过
 * update:status 事件推送（下载进度这类事件不等 IPC 返回）。
 */
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
    // error 事件先于这里触发，状态已由事件处理函数置为 error。
    // 这里只兜底"事件没触发"的情况，避免界面永远停在"检查中"。
    log.error("[update] 检查更新失败:", err);
    if (status.phase === "checking") {
      patch({ phase: "error", error: humanizeError(err) });
    }
  }

  return status;
}

/**
 * 下载更新包
 *
 * 只有在"发现新版本"之后才允许调用 —— 直接调用会走到 electron-updater
 * 内部那条拿不到 updateInfo 的路径，报错信息对用户毫无意义。
 */
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

/**
 * 重启并安装更新
 *
 * 调用后应用会关闭、安装器接管文件替换、装完重新拉起应用。
 * 这一步没有返回值 —— 应用马上就退出了。
 */
export function installUpdate(): { ok: boolean; error?: string } {
  if (status.phase !== "downloaded") {
    return { ok: false, error: "更新包尚未下载完成" };
  }
  try {
    log.info("[update] 触发重启安装");
    // 第一个参数 isSilent=false：装的时候弹出安装向导，不做静默安装。
    //
    // 静默安装（/S）意味着用户看不到任何界面就换掉了程序文件，企业 EDR
    // 会把「无界面执行 + 可执行文件来自缓存目录」判成高危行为。改成
    // 有向导的安装，用户看得见发生了什么，扫描也更容易放行。
    //
    // 第二个参数 isForceRunAfter=true：装完自动重新拉起应用 —— 这一条
    // 保留，它不涉及文件执行路径，只是启动已装好的程序。
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    log.error("[update] 启动安装失败:", err);
    const message = humanizeError(err);
    patch({ phase: "error", error: message });
    return { ok: false, error: message };
  }
}

/** 取当前状态快照 */
export function getUpdateStatus(): UpdateStatus {
  return status;
}

/**
 * 是否处于便携版（供渲染层提示用）
 *
 * 与 isPortableBuild 分开暴露，是因为渲染层需要在按钮旁常驻一句说明，
 * 而不需要知道具体是哪种不支持。
 */
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
