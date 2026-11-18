import { BrowserWindow, ipcMain, app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { log } from "../system/log";
import { getPreloadPath } from "../../utils/paths";
import { shouldHideToTray } from "../system/appState";
import { resolveAppIcon } from "../../utils/assets";
import { IslandWindow } from "./island/island";

let win: BrowserWindow | null = null;
const ipcListenerRefs: Array<{ channel: string; handler: (...args: any[]) => void }> = [];

function showIslandIfEnabled(): void {
  const island = IslandWindow.getInstance();
  if (!island.isEnabled()) return;
  island.show();
}

function shouldAutoOpenDevTools() {
  return process.env.QNOTE_OPEN_DEVTOOLS === "true";
}

export function getMainWindow(): BrowserWindow | null {
  return win;
}

export function showMainWindow(): void {
  if (!win || win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }
  win.setSkipTaskbar(false);
  win.show();
  IslandWindow.getInstance().hide();
}

export function hideMainWindow(): void {
  if (!win || win.isDestroyed()) {
    return;
  }
  if (!win.isVisible()) {
    return;
  }
  win.hide();
  win.setSkipTaskbar(true);
}

export function cleanupMainWindowListeners(): void {
  for (const { channel, handler } of ipcListenerRefs) {
    ipcMain.removeListener(channel, handler);
  }
  ipcListenerRefs.length = 0;
  log.info("主窗口IPC监听器已清理");
}

export function createMainWindow(): BrowserWindow {
  log.info("开始创建主窗口...");

  const iconPath = resolveAppIcon();
  if (iconPath) {
    log.info("主窗口图标路径:", iconPath);
  } else {
    log.warn("未找到主窗口图标文件");
  }

  win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 1000,
    minHeight: 700,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: true,
      plugins: true,
    },
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    icon: iconPath || undefined,
    show: false,
  });

  log.info("主窗口已创建");

  const ALLOWED_PERMISSIONS = new Set([
    "media",
    "clipboard-read",
    "clipboard-write",
    "clipboard-sanitized-write",
  ]);

  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === "media") {
      const mediaTypes = (details as any)?.mediaTypes as string[] | undefined;
      const wantsVideoOnly = Array.isArray(mediaTypes) && mediaTypes.length > 0 &&
        !mediaTypes.includes("audio");
      callback(!wantsVideoOnly);
      return;
    }
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  win.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  const preloadPath = getPreloadPath();
  if (!fs.existsSync(preloadPath)) {
    log.error("preload.js不存在:", preloadPath);
  } else {
    log.info("preload.js存在:", preloadPath);
  }

  const loadUrl = app.isPackaged
    ? `file://${path.join(process.resourcesPath, "renderer/dist", "index.html")}`
    : "http://localhost:5173";

  log.info("准备加载URL:", loadUrl);

  win.once('ready-to-show', () => {
    log.info("窗口准备就绪，显示窗口");
    win?.show();
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error(`加载失败: ${errorCode} - ${errorDescription}`, { url: loadUrl });

    const errorHtml = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>加载错误</title></head>',
      '<body>',
      '<h2>无法加载应用界面</h2>',
      `<p>错误代码: ${errorCode}</p>`,
      `<p>错误描述: ${errorDescription}</p>`,
      `<p>加载URL: ${loadUrl}</p>`,
      '</body></html>',
    ].join('');
    void win?.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`)
      .catch((error) => {
        log.error("加载错误提示页失败:", error);
      });
  });

  win.webContents.on('did-finish-load', () => {
    log.info("页面加载完成");
    win?.webContents.send("window-maximized", win?.isMaximized() ?? false);
  });

  win.loadURL(loadUrl).catch((error) => {
    log.error("加载主窗口页面失败:", error);
  });

  if (!app.isPackaged && shouldAutoOpenDevTools()) {
    log.info("开发环境，按环境变量配置自动打开开发者工具");
    win.webContents.openDevTools();
  }

  win.setMenu(null);

  win.on("close", (event: any) => {
    if (shouldHideToTray() && win) {
      win.hide();
      win.setSkipTaskbar(true);
      event.preventDefault();
      showIslandIfEnabled();
    }
  });

  win.on("closed", () => {
    cleanupMainWindowListeners();
    win = null;
  });

  const maximizeHandler = () => {
    win?.webContents.send("window-maximized", true);
  };
  const unmaximizeHandler = () => {
    win?.webContents.send("window-maximized", false);
  };
  const minimizeStateHandler = () => {
    win?.setSkipTaskbar(false);
    showIslandIfEnabled();
  };
  const restoreStateHandler = () => {
    win?.setSkipTaskbar(false);
    win?.webContents.send("window-maximized", win?.isMaximized() ?? false);
    IslandWindow.getInstance().hide();
  };
  win.on("maximize", maximizeHandler);
  win.on("unmaximize", unmaximizeHandler);
  win.on("minimize", minimizeStateHandler);
  win.on("restore", restoreStateHandler);
  ipcListenerRefs.push(
    { channel: "maximize", handler: maximizeHandler as any },
    { channel: "unmaximize", handler: unmaximizeHandler as any },
    { channel: "minimize", handler: minimizeStateHandler as any },
    { channel: "restore", handler: restoreStateHandler as any }
  );

  const minimizeHandler = () => {
    if (!win) {
      return;
    }

    win.setSkipTaskbar(false);
    win.minimize();
  };
  const maximizeWindowHandler = () => {
    if (!win) {
      return;
    }

    if (win.isMaximized()) {
      win.unmaximize();
    } else if (win.isMaximizable()) {
      win.maximize();
    }
  };
  const openDevToolsHandler = () => {
    log.info("收到打开开发者工具请求");
    if (win) {
      log.info("窗口存在，打开开发者工具");
      win.webContents.openDevTools();
    } else {
      log.error("窗口不存在，无法打开开发者工具");
    }
  };

  ipcMain.on("minimize-window", minimizeHandler);
  ipcMain.on("maximize-window", maximizeWindowHandler);
  ipcMain.on("open-dev-tools", openDevToolsHandler);

  ipcListenerRefs.push(
    { channel: "minimize-window", handler: minimizeHandler as any },
    { channel: "maximize-window", handler: maximizeWindowHandler as any },
    { channel: "open-dev-tools", handler: openDevToolsHandler as any }
  );

  log.info("主窗口事件注册完成");

  return win;
}
