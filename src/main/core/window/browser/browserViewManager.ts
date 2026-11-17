import { BrowserWindow, WebContentsView, session, shell, type WebContents } from "electron";
import { log } from "../../system/log";
import { parseExternalUrl } from "../../../utils/externalUrl";

export const BROWSER_SESSION_PARTITION = "persist:qnote-browser";

export const BROWSER_HOME_URL = "https://www.bing.com";

const BACKGROUND_VIEWPORT = { width: 1280, height: 800 };

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
let browserVisible = false;
let overlayBorrowCount = 0;
let seq = 0;

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

function applyVisibility() {
  const surfaceAvailable = overlayBorrowCount === 0;

  for (const entry of entries) {
    const shouldShow = browserVisible && surfaceAvailable && entry.id === activeTabId;
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.setVisible(shouldShow);
      if (shouldShow && bounds) {
        entry.view.setBounds(bounds);
      } else if (!shouldShow) {
        entry.view.setBounds({ x: 0, y: 0, ...BACKGROUND_VIEWPORT });
      }
    }
  }
}

function createTab(url?: string, activate = true): TabEntry {
  if (!host || host.isDestroyed()) {
    throw new Error("主窗口不可用，无法创建浏览器标签页");
  }

  const id = `bt-${++seq}-${Date.now().toString(36)}`;
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(BROWSER_SESSION_PARTITION),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
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

  wc.setBackgroundThrottling(false);

  wc.on("page-title-updated", () => syncEntry(entry));
  wc.on("page-favicon-updated", () => syncEntry(entry));
  wc.on("did-start-loading", () => syncEntry(entry));
  wc.on("did-stop-loading", () => syncEntry(entry));
  wc.on("did-navigate", () => syncEntry(entry));
  wc.on("did-navigate-in-page", () => syncEntry(entry));

  wc.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
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

  wc.on("will-navigate", (event, url) => {
    if (!isSafeUrl(url)) {
      log.warn("拦截非法协议跳转", { url });
      event.preventDefault();
    }
  });

  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (isSafeUrl(url)) {
      createTab(url, disposition !== "background-tab");
    } else {
      const parsed = parseExternalUrl(url);
      if (parsed) {
        shell.openExternal(parsed.toString()).catch(() => log.warn("无法打开外部链接", { url }));
      } else {
        log.warn("已拦截不允许交给系统打开的链接", { url });
      }
    }
    return { action: "deny" };
  });

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

export function closeTab(id: string): BrowserState {
  const entry = findEntry(id);
  if (!entry) return getState();

  const index = entries.findIndex((e) => e.id === id);
  entries.splice(index, 1);

  if (!entry.view.webContents.isDestroyed()) {
    if (host && !host.isDestroyed()) {
      host.contentView.removeChildView(entry.view);
    }
    entry.view.webContents.close();
  }

  if (activeTabId === id) {
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

export function getActiveWebContents(): WebContents | null {
  const entry = findEntry(activeTabId);
  if (!entry || entry.view.webContents.isDestroyed()) return null;
  return entry.view.webContents;
}

export function getActiveTabId(): string | null {
  return findEntry(activeTabId) ? activeTabId : null;
}

export function attachBrowserManager(win: BrowserWindow) {
  host = win;

  if (entries.some((e) => e.view.webContents.isDestroyed())) {
    entries = entries.filter((e) => !e.view.webContents.isDestroyed());
    if (!findEntry(activeTabId)) {
      activeTabId = entries.length > 0 ? entries[0].id : null;
    }
    bounds = null;
    browserVisible = false;
    overlayBorrowCount = 0;
  }
}

export function disposeBrowserManager() {
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

export function setBounds(next: { x: number; y: number; width: number; height: number }) {
  if (next.width <= 0 || next.height <= 0) return;
  bounds = next;
  applyVisibility();
}

export function setBrowserVisible(visible: boolean) {
  browserVisible = visible;
  applyVisibility();
}

export function borrowBrowserSurface(): () => void {
  overlayBorrowCount++;
  if (overlayBorrowCount === 1) {
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

export function getOverlayBorrowCount(): number {
  return overlayBorrowCount;
}

export function openExternal(url: string) {
  const parsed = parseExternalUrl(url);
  if (!parsed) {
    log.warn("已拦截不允许交给系统打开的链接", { url });
    return Promise.reject(new Error(`不允许的外部链接协议: ${url}`));
  }
  return shell.openExternal(parsed.toString()); // NOSONAR
}
