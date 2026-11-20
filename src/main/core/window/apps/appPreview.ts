import { BrowserWindow, WebContentsView, protocol } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../../system/log";
import { resolveWithin } from "../../apps/appManager";

export const APP_PREVIEW_SCHEME = "qnote-app";

const HOST_PREFIX = "p";

let host: BrowserWindow | null = null;
let view: WebContentsView | null = null;
let visible = false;
let bounds: { x: number; y: number; width: number; height: number } | null = null;

let resolveProjectDir: (projectId: number) => string | null = () => null;

export function registerAppPreviewScheme(): void {
  try {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: APP_PREVIEW_SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          stream: true,
        },
      },
    ]);
  } catch (err) {
    log.error("[app] 注册预览协议失败:", err);
  }
}

export function initAppPreviewProtocol(
  resolver: (projectId: number) => string | null
): void {
  resolveProjectDir = resolver;
  try {
    protocol.handle(APP_PREVIEW_SCHEME, async (request) => {
      try {
        const url = new URL(request.url);
        const match = new RegExp(String.raw`^${HOST_PREFIX}(\d+)$`).exec(url.hostname);
        if (!match) {
          return new Response("无效的项目地址", { status: 400 });
        }
        const projectId = Number(match[1]);
        // eslint-disable-next-line sonarjs/no-extra-arguments -- 初始化用的空实现没有参数，但类型声明接受 projectId
        const dir = resolveProjectDir(projectId); // NOSONAR
        if (!dir) {
          return new Response("项目不存在", { status: 404 });
        }

        const segments = url.pathname
          .split("/")
          .filter((s) => s.length > 0)
          .map((s) => {
            try {
              return decodeURIComponent(s);
            } catch {
              return s;
            }
          });
        const relative = segments.join("/");

        let target = resolveWithin(dir, relative || "index.html");
        if (!target) {
          return new Response("非法路径", { status: 403 });
        }

        let stat: fs.Stats;
        try {
          stat = fs.statSync(target); // NOSONAR
        } catch {
          return new Response("文件不存在", { status: 404 });
        }
        if (stat.isDirectory()) {
          target = path.join(target, "index.html");
          if (!fs.existsSync(target)) {
            return new Response("目录里没有 index.html", { status: 404 });
          }
        }

        const buffer = fs.readFileSync(target);
        return new Response(buffer, {
          status: 200,
          headers: {
            "content-type": guessMimeType(target),
            "cache-control": "no-store",
          },
        });
      } catch (err) {
        log.error("[app] 处理预览请求失败:", err);
        return new Response("预览加载失败", { status: 500 });
      }
    });
  } catch (err) {
    log.error("[app] 安装预览协议处理器失败:", err);
  }
}

export function attachAppPreview(win: BrowserWindow): void {
  host = win;
  disposeAppPreview();
}

export function disposeAppPreview(): void {
  if (view && !view.webContents.isDestroyed()) {
    try {
      host?.contentView.removeChildView(view);
    } catch {
    }
    view.webContents.close();
  }
  view = null;
  visible = false;
  bounds = null;
}

export function loadAppPreview(url: string, projectId?: number): boolean {
  if (!host || host.isDestroyed()) return false;

  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    host.contentView.addChildView(view);

    const wc = view.webContents;
    wc.setBackgroundThrottling(false);

    wc.setWindowOpenHandler(({ url: target }) => {
      log.warn("[app] 拦截预览页尝试打开新窗口", { url: target });
      return { action: "deny" };
    });

    wc.on("will-navigate", (event, target) => {
      const allowed =
        target.startsWith(`${APP_PREVIEW_SCHEME}://`) ||
        /^https?:\/\//i.test(target);
      if (!allowed) {
        log.warn("[app] 拦截预览页非法跳转", { url: target });
        event.preventDefault();
      }
    });
  }

  view.webContents
    .loadURL(url)
    .then(() => {
      notifyPreviewLoaded(projectId);
    })
    .catch((err: unknown) => {
      if (isAbortedError(err)) {
        return;
      }
      log.warn("[app] 预览页面加载失败:", err);
      notifyPreviewError(projectId, url, err);
    });
  applyVisibility();
  return true;
}

function isAbortedError(err: unknown): boolean {
  return err instanceof Error && /ERR_ABORTED/i.test(err.message);
}

function describeLoadError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (JSON.stringify(err) ?? String(err));
  const table: [RegExp, string][] = [
    [/ERR_CONNECTION_REFUSED/i, "连接被拒绝 —— 服务可能还没启动"],
    [/ERR_NAME_NOT_RESOLVED/i, "域名解析失败"],
    [/ERR_CONNECTION_TIMED_OUT/i, "连接超时"],
    [/ERR_ADDRESS_UNREACHABLE/i, "地址不可达"],
    [/ERR_FILE_NOT_FOUND/i, "文件不存在"],
    [/ERR_ACCESS_DENIED/i, "访问被拒绝"],
  ];
  for (const [pattern, text] of table) {
    if (pattern.test(raw)) return text;
  }
  return raw;
}

function notifyPreviewLoaded(projectId: number | undefined): void {
  if (!host || host.isDestroyed()) return;
  try {
    host.webContents.send("app:preview-loaded", { projectId });
  } catch {
  }
}

function notifyPreviewError(
  projectId: number | undefined,
  url: string,
  err: unknown
): void {
  if (!host || host.isDestroyed()) return;
  try {
    host.webContents.send("app:preview-error", {
      projectId,
      url,
      message: describeLoadError(err),
    });
  } catch {
  }
}

export function setAppPreviewVisible(next: boolean): void {
  visible = next;
  applyVisibility();
}

export function setAppPreviewBounds(next: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  if (next.width <= 0 || next.height <= 0) return;
  bounds = next;
  applyVisibility();
}

export function isAppPreviewVisible(): boolean {
  return visible;
}

function applyVisibility(): void {
  if (!view || view.webContents.isDestroyed()) return;
  const shouldShow = visible && !!bounds;
  view.setVisible(shouldShow);
  if (shouldShow && bounds) {
    view.setBounds(bounds);
  }
}

function guessMimeType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".cjs": "text/javascript; charset=utf-8",
    ".jsx": "text/javascript; charset=utf-8",
    ".ts": "text/plain; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };
  return map[ext] ?? "application/octet-stream";
}
