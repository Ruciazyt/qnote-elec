import { BrowserWindow, screen, ipcMain } from "electron";
import * as path from "node:path";
import { app } from "electron";
import { log } from "../../utils/log";
import { stickyNoteManager } from "./stickyNote";

// 跟踪IPC监听器引用，用于清理
const ipcListenerRefs: Array<{ channel: string; handler: (...args: any[]) => void }> = [];

function cleanupIpcListeners(): void {
  for (const { channel, handler } of ipcListenerRefs) {
    ipcMain.removeListener(channel, handler);
  }
  ipcListenerRefs.length = 0;
  log.info("[clipboardPopup] IPC监听器已清理");
}

const DEV_SERVER_URL = "http://localhost:5173";

function getAssetsDir() {
  return !app.isPackaged
    ? path.join(app.getAppPath(), "resources")
    : path.join(process.resourcesPath, "resources");
}

function resolveAssetPath(fileName: string) {
  return path.join(getAssetsDir(), fileName);
}

function getPreloadPath() {
  return path.join(__dirname, "..", "..", "preload.js");
}

function getPopupPosition(w: number, h: number) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { width, height } = display.workAreaSize;
  const { x: dx, y: dy } = display.bounds;
  const margin = 80;
  let x = cursor.x - Math.floor(w / 2);
  x = Math.max(dx, Math.min(x, dx + width - w - margin));
  let y = Math.max(dy, dy + height - h - margin);
  if (x < dx) x = dx + margin;
  if (y < dy) y = dy + margin;
  return { x, y };
}

export class ClipboardPopupWindow {
  private static instance: ClipboardPopupWindow;
  private win: BrowserWindow | null = null;

  static getInstance(): ClipboardPopupWindow {
    if (!ClipboardPopupWindow.instance) {
      ClipboardPopupWindow.instance = new ClipboardPopupWindow();
    }
    return ClipboardPopupWindow.instance;
  }

  show(): void {
    if (!this.win) this.win = this.create();
    this.win.show();
    this.win.focus();
  }

  hide(): void {
    this.win?.hide();
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false;
  }

  // 销毁窗口，释放资源
  destroy(): void {
    if (this.win) {
      // 清理IPC监听器
      cleanupIpcListeners();
      // 清理窗口事件监听器
      this.win.removeAllListeners();
      this.win.destroy();
      this.win = null;
      log.info("[clipboardPopup] 窗口已销毁");
    }
  }

  private create(): BrowserWindow {
    const pos = getPopupPosition(360, 480);
    const win = new BrowserWindow({
      width: 360,
      height: 480,
      x: pos.x,
      y: pos.y,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        // 用默认 session（不指定 partition），与主窗口共享 localStorage ——
        // popup-clipboard.html 要从 qnote-theme 读用户选好的主题档位。
        // 之前写的 `persist:main` 是另一个独立 session，读出来永远是 null，
        // 主题只能退化成跟随系统。
      },
    });

    if (!app.isPackaged) {
      // 开发环境：使用 vite dev server
      // loadURL 失败（开发服务器没起等）会 reject，接住并记日志，
      // 免得变成"未处理的Promise拒绝"。
      win.loadURL(`${DEV_SERVER_URL}/src/renderer/components/clipboard/popup-main.tsx`).catch((error) => {
        log.error("[clipboardPopup] 加载开发服务器页面失败:", error);
      });
    } else {
      // 生产环境：使用构建后的 HTML 文件
      const htmlPath = resolveAssetPath("popup-clipboard.html");
      log.info("[clipboardPopup] 加载 HTML:", htmlPath);
      win.loadFile(htmlPath).catch((error) => {
        log.error("[clipboardPopup] 加载 HTML 失败:", error);
      });
    }

    // 失去焦点自动隐藏
    win.on("blur", () => {
      // 正在长按生成屏幕便签时**不能藏**：
      // 便签生成的那一刻会弹出新窗口，弹窗一失焦就藏的话，
      // 用户按着的那张卡就没了，按住的 1.2 秒也白按。
      if (stickyNoteManager.isDragActive()) return;
      this.hide();
    });

    // 注册 popup-close IPC - 使用命名函数以便跟踪
    const popupCloseHandler = () => this.hide();
    ipcMain.on("popup-close", popupCloseHandler);
    ipcListenerRefs.push({ channel: "popup-close", handler: popupCloseHandler });

    // 注册 popup-show-main-window IPC
    const popupShowMainWindowHandler = () => {
      const { getMainWindow } = require("./mainWindow");
      const main = getMainWindow();
      if (main) {
        main.setSkipTaskbar(false);
        main.show();
        main.focus();
      }
    };
    ipcMain.on("popup-show-main-window", popupShowMainWindowHandler);
    ipcListenerRefs.push({ channel: "popup-show-main-window", handler: popupShowMainWindowHandler });

    log.info("[clipboardPopup] 窗口创建成功");
    return win;
  }
}
