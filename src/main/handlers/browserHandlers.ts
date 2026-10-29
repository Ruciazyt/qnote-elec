import { ipcMain } from "electron";
import { log } from "../utils/log";
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
  openExternal,
  getState,
  type BrowserState,
} from "../core/window/browserViewManager";

export type BrowserNavigateAction = "back" | "forward" | "reload" | "stop";

/** 借出 token → 主进程侧的归还闭包。归还必须显式调用，否则表层会一直处于借出状态。 */
const borrowTokens = new Map<number, () => void>();
let borrowSeq = 0;

/**
 * 内嵌浏览器 IPC
 * 所有 channel 前缀 browser:，与主进程 browserViewManager 的状态变更事件对称
 */
export function registerBrowserHandlers(win: Electron.BrowserWindow | null) {
  if (win) {
    attachBrowserManager(win);
  }

  /** 渲染进程挂载浏览器页面 → 同步 tab 列表并确保至少有一个标签 */
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

  /** 内容区尺寸同步 — 由渲染进程的 ResizeObserver 驱动 */
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

  /** 页面显隐 — 切走浏览器 tab 时必须隐藏，否则 view 会盖住整个窗口 */
  ipcMain.handle("browser:set-visible", (_event, visible: boolean) => {
    setBrowserVisible(!!visible);
  });

  /**
   * 借出网页表层 — 让渲染进程的浮层（弹窗/下拉）能显示在网页之上
   *
   * WebContentsView 由 OS 合成器画在 DOM 之上，z-index 压不住，
   * 只能让它暂时不参与合成。借出期间网页不卸载、状态完整保留。
   *
   * 跨进程传不了函数，所以用 token 映射回主进程里的归还闭包。
   * 归还必须由渲染层显式调用；渲染进程重载时 attachBrowserManager 会清零计数。
   */
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
      // 已归还过或 token 无效 —— 幂等，不报错
      return false;
    }
    borrowTokens.delete(token);
    release();
    log.info("网页表层已归还", { token, depth: getOverlayBorrowCount() });
    return true;
  });

  /** 兜底：渲染层异常卸载时一次性归还全部借出 */
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

  ipcMain.handle("browser:open-external", async (_event, url: string) => {
    try {
      await openExternal(url);
      return true;
    } catch (err) {
      log.error("browser:open-external error:", err);
      return false;
    }
  });

  log.info("内嵌浏览器 IPC 处理器已注册");
}

/** 主窗口销毁 / 应用退出时释放内嵌浏览器的 WebContentsView */
export function teardownBrowserHandlers() {
  // 先归还所有借出，再释放 view。
  // 顺序反了的话 release() 会在 entries 已清空后触发 applyVisibility，
  // 行为虽无害，但计数会短暂失衡。
  for (const release of borrowTokens.values()) {
    release();
  }
  borrowTokens.clear();
  borrowSeq = 0;
  disposeBrowserManager();
}
