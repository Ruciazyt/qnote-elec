import { ipcMain } from "electron";
import { log } from "../../core/system/log";
import {
  attachBrowserManager,
  disposeBrowserManager,
  ensureTab,
  activateTab,
  openTab,
  closeTab,
  loadUrl,
  navigate,
  setBounds,
  setBrowserVisible,
  borrowBrowserSurface,
  getOverlayBorrowCount,
  getState,
  type BrowserState,
} from "../../core/window/browser/browserViewManager";

export type BrowserNavigateAction = "back" | "forward" | "reload" | "stop";

const borrowTokens = new Map<number, () => void>();
let borrowSeq = 0;

export function registerBrowserHandlers(win: Electron.BrowserWindow | null) {
  if (win) {
    attachBrowserManager(win);
  }

  ipcMain.handle("browser:get-state", (): BrowserState => {
    try {
      return ensureTab();
    } catch (err) {
      log.error("browser:get-state error:", err);
      return { tabs: [], activeTabId: null };
    }
  });

  ipcMain.handle("browser:create-tab", (_event, url?: string): BrowserState => {
    try {
      openTab(typeof url === "string" ? url : undefined);
      return getState();
    } catch (err) {
      log.error("browser:create-tab error:", err);
      return getState();
    }
  });

  ipcMain.handle("browser:close-tab", (_event, tabId: string): BrowserState => {
    try {
      return closeTab(tabId);
    } catch (err) {
      log.error("browser:close-tab error:", err);
      return getState();
    }
  });

  ipcMain.handle("browser:activate-tab", (_event, tabId: string): BrowserState => {
    try {
      activateTab(tabId);
      return getState();
    } catch (err) {
      log.error("browser:activate-tab error:", err);
      return getState();
    }
  });

  ipcMain.handle("browser:load-url", (_event, tabId: string, url: string) => {
    loadUrl(tabId, url);
  });

  ipcMain.handle("browser:navigate", (_event, tabId: string, action: BrowserNavigateAction) => {
    navigate(tabId, action);
  });

  ipcMain.handle(
    "browser:set-bounds",
    (_event, next: { x: number; y: number; width: number; height: number }) => {
      if (!next) return;
      setBounds({
        x: Math.round(next.x),
        y: Math.round(next.y),
        width: Math.round(next.width),
        height: Math.round(next.height),
      });
    }
  );

  ipcMain.handle("browser:set-visible", (_event, visible: boolean) => {
    setBrowserVisible(!!visible);
  });

  ipcMain.handle("browser:borrow-surface", () => {
    const token = ++borrowSeq;
    const release = borrowBrowserSurface();
    borrowTokens.set(token, release);
    log.info("网页表层已借出", { token, depth: getOverlayBorrowCount() });
    return token;
  });

  ipcMain.handle("browser:release-surface", (_event, token: number) => {
    const release = typeof token === "number" ? borrowTokens.get(token) : undefined;
    if (!release) {
      return false;
    }
    borrowTokens.delete(token);
    release();
    log.info("网页表层已归还", { token, depth: getOverlayBorrowCount() });
    return true;
  });

  ipcMain.handle("browser:release-all-surfaces", () => {
    const count = borrowTokens.size;
    for (const release of borrowTokens.values()) {
      release();
    }
    borrowTokens.clear();
    if (count > 0) {
      log.info("已归还全部借出表层", { count });
    }
    return count;
  });

  log.info("内嵌浏览器 IPC 处理器已注册");
}

export function teardownBrowserHandlers() {
  for (const release of borrowTokens.values()) {
    release();
  }
  borrowTokens.clear();
  borrowSeq = 0;
  disposeBrowserManager();
}
