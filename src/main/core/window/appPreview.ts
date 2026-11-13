import { BrowserWindow, WebContentsView, protocol } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../../utils/log";
import { resolveWithin } from "../appManager";

/**
 * 应用预览 —— 用原生视图加载项目里的 HTML
 *
 * ## 为什么不用 iframe / 直接 file://
 *
 * - `file://` 下 Chromium 会以 CORS 为由拦掉 `<script type="module">`，
 *   绝大多数 vite / esbuild 产物的 HTML 都是 ESM，一打开就是白屏。
 * - 渲染层是 `file://`（打包版）或 `http://localhost:5173`（开发版），
 *   从里面加载自定义 scheme 的 iframe 会被当成跨源内容拦掉。
 *
 * 所以给项目目录注册一个私有 scheme `qnote-app://`，由主进程直接读文件返回。
 * 每个项目一个独立 origin（`qnote-app://p12/...`），项目之间互相读不到文件。
 */
export const APP_PREVIEW_SCHEME = "qnote-app";

/** 项目 id → 主机名，p12 表示项目 12 */
const HOST_PREFIX = "p";

/** 预览视图的宿主窗口 */
let host: BrowserWindow | null = null;
let view: WebContentsView | null = null;
let visible = false;
let bounds: { x: number; y: number; width: number; height: number } | null = null;

/** 项目 id → 项目根目录。由 appManager 注入。 */
let resolveProjectDir: (projectId: number) => string | null = () => null;

/**
 * 注册 scheme 权限 —— **必须在 app ready 之前调用**
 *
 * standard: 让它像 http(s) 一样有 origin，ES module 才能加载
 * secure: 不被当成不安全来源
 * corsEnabled: 页面里 fetch 同源资源不会被 CORS 拦
 */
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

/** 安装协议处理器 —— app ready 之后调用 */
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

        // 逐段解码，避免把 %2F 还原成路径分隔符
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
            // 预览内容随时可能变，禁止缓存，免得改了 HTML 刷新还看到旧的
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

/** 挂载预览视图到宿主窗口 */
export function attachAppPreview(win: BrowserWindow): void {
  host = win;
  disposeAppPreview();
}

/** 释放预览视图 */
export function disposeAppPreview(): void {
  if (view && !view.webContents.isDestroyed()) {
    try {
      host?.contentView.removeChildView(view);
    } catch {
      /* 窗口可能已经销毁 */
    }
    view.webContents.close();
  }
  view = null;
  visible = false;
  bounds = null;
}

/**
 * 载入预览页面
 *
 * @param url 目标地址。相对路径由调用方拼成 `qnote-app://p<id>/...`，
 *            http(s) 网址原样加载。
 * @param projectId 归属的项目 id —— 加载失败时要告诉渲染层是哪个项目出的问题
 */
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

    // 预览页里的 window.open 一律拦掉 —— 它不该在应用外开出窗口
    wc.setWindowOpenHandler(({ url: target }) => {
      log.warn("[app] 拦截预览页尝试打开新窗口", { url: target });
      return { action: "deny" };
    });

    // 只允许继续在预览域内或 http(s) 之间跳转，file: / javascript: 之类不放行
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

  view.webContents.loadURL(url).catch((err: unknown) => {
    if (isAbortedError(err)) {
      // 导航被取消 —— 不是故障，不记警告
      return;
    }
    log.warn("[app] 预览页面加载失败:", err);
    notifyPreviewError(projectId, url, err);
  });
  applyVisibility();
  return true;
}

/**
 * 这次导航是不是被取消的
 *
 * Chromium 的 ERR_ABORTED (-3) 说的是「这次导航没走完」，不是「加载失败」：
 *   - 被新的 loadURL 顶掉了（切项目时必然发生一次）
 *   - 被 will-navigate 主动拦下了（预览页跳向非法地址）
 * 两种都是预期行为，之前一律记成 WARN，日志里全是假警报。
 */
function isAbortedError(err: unknown): boolean {
  return err instanceof Error && /ERR_ABORTED/i.test(err.message);
}

/** 把 Chromium 的网络错误码翻译成人话 */
function describeLoadError(err: unknown): string {
  // 未知值不能直接 String() —— 对象会变成 "[object Object]"
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

/**
 * 把预览加载失败告诉渲染层
 *
 * 光写日志用户看不见 —— 预览区会是一片空白，人只能对着日志猜。
 * 推一个事件过去，渲染层弹 toast 说清楚是哪个项目、什么原因。
 */
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
    // 窗口可能正在销毁，忽略
  }
}

/** 显示 / 隐藏预览视图 */
export function setAppPreviewVisible(next: boolean): void {
  visible = next;
  applyVisibility();
}

/**
 * 同步预览视图的位置
 *
 * 渲染层给的是页面内元素的真实矩形 —— 原生视图不跟 DOM 走，
 * 位置对不上就会错位或挡住整个窗口。
 */
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

/** 当前是否处于显示状态 —— 渲染层据此决定要不要让出浮层 */
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

/** 按扩展名猜 MIME —— 猜不到就按二进制流发，浏览器照样能显示 */
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
