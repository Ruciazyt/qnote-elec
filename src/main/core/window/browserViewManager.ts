import { BrowserWindow, WebContentsView, session, shell, type WebContents } from "electron";
import { log } from "../../utils/log";

/**
 * 浏览器专用持久化会话分区
 * - `persist:` 前缀让 cookie / localStorage 落盘，重启应用后登录态不丢
 * - 与应用自身渲染进程分区隔离，网页 JS 拿不到应用 preload 暴露的任何能力
 */
export const BROWSER_SESSION_PARTITION = "persist:qnote-browser";

/** 新标签页默认首页 / 搜索兜底 */
export const BROWSER_HOME_URL = "https://www.bing.com";

/**
 * 后台标签的兜底视口尺寸
 *
 * 问题：隐藏状态下 applyVisibility 不会调 setBounds，而新建的 WebContentsView
 * 默认 bounds 是 0×0。视口为 0 时，页面里每个元素的 getBoundingClientRect()
 * 都返回 0，AI 快照里的可见性过滤会把**所有**元素判掉 —— 等于递给 AI 一张白纸。
 *
 * 所以即便标签不可见，也要给它一个正常视口。这和真实浏览器的后台标签行为一致
 * （后台标签保留视口尺寸，切回来不重排）。
 */
const BACKGROUND_VIEWPORT = { width: 1280, height: 800 };

/** 单个标签页的可序列化状态 — 主进程是唯一数据源，渲染进程只做展示 */
export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserState {
  tabs: BrowserTabState[];
  activeTabId: string | null;
}

interface TabEntry {
  id: string;
  view: WebContentsView;
  state: BrowserTabState;
}

let entries: TabEntry[] = [];
let activeTabId: string | null = null;
let host: BrowserWindow | null = null;
let bounds: { x: number; y: number; width: number; height: number } | null = null;
/** 浏览器页面是否处于前台（切走时必须隐藏，否则 view 会盖住整个窗口） */
let browserVisible = false;
/**
 * 「借出」计数 — 当前有多少层应用自己的浮层正借用网页表层
 *
 * WebContentsView 是 OS 合成器上的独立图层，永远盖在 workbench DOM 之上，
 * z-index 对它无效（和 VS Code 的 browserView 面临同一个物理限制）。
 * 所以渲染进程要显示自己的弹窗/下拉时，只能让原生层**暂时不存在**：
 * 借出期间 setVisible(false)，关掉后再显示回来。
 *
 * 用计数器而非布尔，是为了支持嵌套借出（权限弹窗上再叠一层确认框）。
 */
let overlayBorrowCount = 0;
let seq = 0;

/** 仅允许 http/https，挡掉 file:// 等本地协议 */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function send(channel: string, payload: unknown) {
  if (host && !host.isDestroyed()) {
    host.webContents.send(channel, payload);
  }
}

function findEntry(id: string | null): TabEntry | undefined {
  if (!id) return undefined;
  return entries.find((e) => e.id === id);
}

function emitTabsChanged() {
  send("browser:tabs-changed", getState());
}

/**
 * 同步单个标签页状态 → 推送给渲染进程
 * webContents 事件较多，这里做浅比较避免无意义的跨进程推送
 */
function syncEntry(entry: TabEntry) {
  const wc = entry.view.webContents;
  if (wc.isDestroyed()) return;

  const next: BrowserTabState = {
    id: entry.id,
    title: wc.getTitle() || "新标签页",
    url: wc.getURL() || "",
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  };

  const prev = entry.state;
  if (
    prev.title === next.title &&
    prev.url === next.url &&
    prev.loading === next.loading &&
    prev.canGoBack === next.canGoBack &&
    prev.canGoForward === next.canGoForward
  ) {
    return;
  }

  entry.state = next;
  send("browser:tab-updated", next);
}

/**
 * 应用「显示哪一个 view」到实际视图上
 * 非激活标签一律隐藏 — 多个 WebContentsView 同时显示会互相盖住
 *
 * 隐藏判定有三个来源，任一成立即隐藏：
 * 1. 浏览器页不在前台（browserVisible）
 * 2. 不是激活标签
 * 3. 有浮层借用了表层（overlayBorrowCount > 0）
 *
 * 注意：隐藏 ≠ 停用。所有标签都保持 webContents 存活、保持有效视口，
 * AI 工具才能在用户不打开浏览器页时照常操作后台标签。
 */
function applyVisibility() {
  const surfaceAvailable = overlayBorrowCount === 0;

  for (const entry of entries) {
    const shouldShow = browserVisible && surfaceAvailable && entry.id === activeTabId;
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.setVisible(shouldShow);
      if (shouldShow && bounds) {
        entry.view.setBounds(bounds);
      } else if (!shouldShow) {
        // 隐藏的标签也要有正常视口，见 BACKGROUND_VIEWPORT 的说明
        entry.view.setBounds({ x: 0, y: 0, ...BACKGROUND_VIEWPORT });
      }
    }
  }
}

/**
 * 创建单个 WebContentsView 并挂到窗口上
 * @param activate 创建后是否立即激活（window.open 的后台标签不抢焦点）
 */
function createTab(url?: string, activate = true): TabEntry {
  if (!host || host.isDestroyed()) {
    throw new Error("主窗口不可用，无法创建浏览器标签页");
  }

  const id = `bt-${++seq}-${Date.now().toString(36)}`;
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(BROWSER_SESSION_PARTITION),
      // 浏览器内容完全沙箱化，不给 Node 能力
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // 允许站点使用常规的音视频 / 剪贴板等能力，但不开放任意下载提示绕过
      spellcheck: true,
    },
  });

  const entry: TabEntry = {
    id,
    view,
    state: {
      id,
      title: "新标签页",
      url: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  };

  host.contentView.addChildView(view);

  const wc = view.webContents;

  /**
   * 关掉后台节流
   *
   * Chromium 默认把隐藏页面的定时器压到约 1Hz。AI 要能在页面不可见时正常操作，
   * 而懒加载、自动提交、轮询类页面依赖定时器 —— 被节流后元素迟迟不出现，
   * AI 会误判成"页面上没有这个按钮"。
   */
  wc.setBackgroundThrottling(false);

  wc.on("page-title-updated", () => syncEntry(entry));
  wc.on("page-favicon-updated", () => syncEntry(entry));
  wc.on("did-start-loading", () => syncEntry(entry));
  wc.on("did-stop-loading", () => syncEntry(entry));
  wc.on("did-navigate", () => syncEntry(entry));
  wc.on("did-navigate-in-page", () => syncEntry(entry));

  wc.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED，页面跳转/取消时的正常表现，不算错误
    if (errorCode === -3 || !isMainFrame) return;
    log.warn("网页加载失败", { errorCode, errorDescription, url: validatedURL });
    entry.state = { ...entry.state, loading: false, url: validatedURL || entry.state.url };
    send("browser:load-error", {
      tabId: entry.id,
      url: validatedURL,
      errorCode,
      errorDescription,
    });
  });

  // 拦截跳转越权：不允许网页把视图导航到本地文件等非 http(s) 协议
  wc.on("will-navigate", (event, url) => {
    if (!isSafeUrl(url)) {
      log.warn("拦截非法协议跳转", { url });
      event.preventDefault();
    }
  });

  // window.open / target=_blank → 在应用内开新标签，而不是弹出一个脱离管理的系统窗口
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (isSafeUrl(url)) {
      createTab(url, disposition !== "background-tab");
    } else {
      shell.openExternal(url).catch(() => log.warn("无法打开外部链接", { url }));
    }
    return { action: "deny" };
  });

  // 网页自行关闭（window.close）时同步关掉标签页
  wc.on("destroyed", () => {
    closeTab(id);
  });

  entries.push(entry);

  if (activate) {
    activeTabId = id;
  }

  const target = url && isSafeUrl(url) ? url : BROWSER_HOME_URL;
  wc.loadURL(target).catch((err) => log.warn("loadURL 调用失败", err));

  applyVisibility();
  emitTabsChanged();

  return entry;
}

/** 关闭标签页 — 关掉最后一个时自动补一个新标签，避免浏览器区域空白无解 */
export function closeTab(id: string): BrowserState {
  const entry = findEntry(id);
  if (!entry) return getState();

  const index = entries.findIndex((e) => e.id === id);
  entries.splice(index, 1);

  if (!entry.view.webContents.isDestroyed()) {
    if (host && !host.isDestroyed()) {
      host.contentView.removeChildView(entry.view);
    }
    // close 会触发 destroyed → 再次调用 closeTab，靠上面的 findEntry 提前返回避免递归
    entry.view.webContents.close();
  }

  if (activeTabId === id) {
    // 优先激活右邻，其次左邻
    const next = entries[index] ?? entries[index - 1];
    activeTabId = next ? next.id : null;
    if (!next) {
      createTab();
    }
  }

  applyVisibility();
  emitTabsChanged();
  return getState();
}

export function getState(): BrowserState {
  return {
    tabs: entries.map((e) => e.state),
    activeTabId,
  };
}

/**
 * 当前活动标签页的 webContents — AI 浏览器工具层的唯一入口
 *
 * 只暴露只读句柄：调用方拿不到 entries 数组本身，无法新建/关闭标签，
 * 只能对"用户当前正在看的那个页面"执行脚本和导航。
 * 没有活动页或 view 已销毁时返回 null。
 */
export function getActiveWebContents(): WebContents | null {
  const entry = findEntry(activeTabId);
  if (!entry || entry.view.webContents.isDestroyed()) return null;
  return entry.view.webContents;
}

/** 当前活动标签 id（无活动标签返回 null） */
export function getActiveTabId(): string | null {
  return findEntry(activeTabId) ? activeTabId : null;
}

/** 渲染进程挂载 → 绑定宿主窗口 */
export function attachBrowserManager(win: BrowserWindow) {
  host = win;

  // 主窗口被销毁重建时，旧的 view 已失效但可能仍留在 entries 里。
  // 这里清掉所有 webContents 已销毁的孤儿条目，避免后续操作抛错或渲染到已死的视图上。
  if (entries.some((e) => e.view.webContents.isDestroyed())) {
    entries = entries.filter((e) => !e.view.webContents.isDestroyed());
    if (!findEntry(activeTabId)) {
      activeTabId = entries.length > 0 ? entries[0].id : null;
    }
    bounds = null;
    browserVisible = false;
    // 渲染进程重载 → 之前的借出方已经不存在，计数必须归零，
    // 否则表层会永久停留在借出状态（网页再也不显示）。
    overlayBorrowCount = 0;
  }
}

/** 应用退出 / 主窗口销毁 → 释放所有 view，避免 webContents 泄漏 */
export function disposeBrowserManager() {
  // 先把状态清空再 close：close() 会触发 destroyed → closeTab 重入，
  // 若此时 entries 还在，边遍历边 splice 会漏掉条目。
  const doomed = entries;
  entries = [];
  activeTabId = null;
  host = null;
  bounds = null;
  browserVisible = false;
  overlayBorrowCount = 0;

  for (const entry of doomed) {
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  }
  log.info("浏览器 WebContentsView 已全部释放");
}

/** 确保至少存在一个标签页（浏览器页面首次挂载时调用） */
export function ensureTab(): BrowserState {
  if (entries.length === 0) {
    createTab();
  }
  return getState();
}

export function activateTab(id: string) {
  if (!findEntry(id)) return;
  activeTabId = id;
  applyVisibility();
  emitTabsChanged();
}

export function openTab(url?: string) {
  createTab(url, true);
  emitTabsChanged();
}

/** 刷新所有标签页（AI 工具或未来的"全部重载"入口用） */
export function reloadAllTabs() {
  for (const entry of entries) {
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.reload();
    }
  }
  log.info("已刷新全部浏览器标签页", { count: entries.length });
}

export function loadUrl(id: string, url: string) {
  const entry = findEntry(id);
  if (!entry || entry.view.webContents.isDestroyed()) return;
  entry.view.webContents.loadURL(isSafeUrl(url) ? url : BROWSER_HOME_URL).catch((err) =>
    log.warn("loadURL 调用失败", err)
  );
}

export function navigate(id: string, action: "back" | "forward" | "reload" | "stop") {
  const entry = findEntry(id);
  if (!entry || entry.view.webContents.isDestroyed()) return;
  const wc = entry.view.webContents;

  switch (action) {
    case "back":
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      break;
    case "forward":
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      break;
    case "reload":
      wc.reload();
      break;
    case "stop":
      wc.stop();
      break;
  }
  syncEntry(entry);
}

/** 渲染进程把内容区真实像素位置同步过来 */
export function setBounds(next: { x: number; y: number; width: number; height: number }) {
  // 宽高为 0 时 setBounds 会让 view 消失，这里做一次兜底
  if (next.width <= 0 || next.height <= 0) return;
  bounds = next;
  applyVisibility();
}

/** 浏览器页面挂载/卸载时控制 view 显隐 */
export function setBrowserVisible(visible: boolean) {
  browserVisible = visible;
  applyVisibility();
}

/**
 * 借出网页表层 — 渲染进程要显示自己的浮层（弹窗/下拉/对话框）时调用
 *
 * 原理：WebContentsView 由 OS 合成器绘制在 DOM 之上，z-index 无效，
 * 所以只能让这层**暂时不参与合成**，底下的 DOM 才露得出来。
 * 借出期间网页并未卸载 —— webContents 存活、JS 继续跑、页面状态完整保留。
 *
 * 代价：这段时间网页是看不见的，浮层关闭后会有一帧切换感。
 *
 * @returns 归还函数。可重复调用（幂等），支持嵌套借出。
 */
export function borrowBrowserSurface(): () => void {
  overlayBorrowCount++;
  if (overlayBorrowCount === 1) {
    // 交还焦点：网页浏览过之后焦点留在它的 webContents 上，
    // 不交还的话用户在弹窗里敲键盘，字符会打进被藏起来的网页。
    if (host && !host.isDestroyed()) {
      host.webContents.focus();
    }
  }
  applyVisibility();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlayBorrowCount = Math.max(0, overlayBorrowCount - 1);
    applyVisibility();
  };
}

/** 当前借出层数 — 供调试与渲染层对齐状态用 */
export function getOverlayBorrowCount(): number {
  return overlayBorrowCount;
}

/** 交给系统默认浏览器打开（用于不支持内嵌的协议，如 mailto:） */
export function openExternal(url: string) {
  return shell.openExternal(url);
}
