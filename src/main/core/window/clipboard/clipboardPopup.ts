import { BrowserWindow, screen, ipcMain, app } from "electron";
import * as path from "node:path";
import { log } from "../../system/log";
import { getPreloadPath } from "../../../utils/paths";
import { stickyNoteManager } from "../sticky/stickyNote";
import { hideMainWindow, showMainWindow } from "../mainWindow";
import { configManager } from "../../system/config";
import {
  clipboardPanelWindowSize,
  type ClipboardPanelPosition,
} from "../../../../shared/clipboard/clipboardPanel";

const ipcListenerRefs: Array<{ channel: string; handler: (...args: any[]) => void }> = [];

function cleanupIpcListeners(): void {
  for (const { channel, handler } of ipcListenerRefs) {
    ipcMain.removeListener(channel, handler);
  }
  ipcListenerRefs.length = 0;
  log.info("[clipboardPopup] IPC监听器已清理");
}

const DEV_SERVER_URL = "http://localhost:5173";

const SCREEN_MARGIN = 40;

function panelBounds(position: ClipboardPanelPosition): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const windowSize = clipboardPanelWindowSize(position);

  const width = Math.min(
    windowSize.width,
    area.width - SCREEN_MARGIN * 2
  );
  const height = Math.min(
    windowSize.height,
    area.height - SCREEN_MARGIN * 2
  );

  let x: number;
  let y: number;
  if (position === "side") {
    x = area.x + area.width - width - SCREEN_MARGIN;
    y = area.y + Math.max(SCREEN_MARGIN, Math.round((area.height - height) / 2));
  } else {
    x = area.x + Math.round((area.width - width) / 2);
    y = area.y + area.height - height - SCREEN_MARGIN;
  }
  return { x, y, width, height };
}

export class ClipboardPopupWindow {
  private static instance: ClipboardPopupWindow;
  private win: BrowserWindow | null = null;
  private ready = false;

  static getInstance(): ClipboardPopupWindow {
    if (!ClipboardPopupWindow.instance) {
      ClipboardPopupWindow.instance = new ClipboardPopupWindow();
    }
    return ClipboardPopupWindow.instance;
  }

  async show(): Promise<void> {
    const position = await configManager.getClipboardPanelPosition();
    if (!this.win) this.win = this.create();
    const win = this.win;
    if (!win || win.isDestroyed()) return;

    win.setBounds(panelBounds(position), false);
    hideMainWindow();

    if (this.ready) {
      win.show();
      win.focus();
      win.webContents.send("popup:refresh");
    }
  }

  hide(): void {
    this.win?.hide();
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false;
  }

  destroy(): void {
    if (this.win) {
      cleanupIpcListeners();
      this.win.removeAllListeners();
      this.win.destroy();
      this.win = null;
      this.ready = false;
      log.info("[clipboardPopup] 窗口已销毁");
    }
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: 800,
      height: 240,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    if (!app.isPackaged) {
      win.loadURL(`${DEV_SERVER_URL}/popup-clipboard.html`).catch((error) => {
        log.error("[clipboardPopup] 加载开发服务器页面失败:", error);
      });
    } else {
      const htmlPath = path.join(
        process.resourcesPath,
        "renderer",
        "dist",
        "popup-clipboard.html"
      );
      log.info("[clipboardPopup] 加载 HTML:", htmlPath);
      win.loadFile(htmlPath).catch((error) => {
        log.error("[clipboardPopup] 加载 HTML 失败:", error);
      });
    }

    win.once("ready-to-show", () => {
      this.ready = true;
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });

    win.on("blur", () => {
      if (process.platform === "darwin") return;
      if (stickyNoteManager.isDragActive()) return;
      this.hide();
    });

    const popupCloseHandler = () => this.hide();
    ipcMain.on("popup-close", popupCloseHandler);
    ipcListenerRefs.push({ channel: "popup-close", handler: popupCloseHandler });

    const popupShowMainWindowHandler = () => {
      this.hide();
      showMainWindow();
    };
    ipcMain.on("popup-show-main-window", popupShowMainWindowHandler);
    ipcListenerRefs.push({ channel: "popup-show-main-window", handler: popupShowMainWindowHandler });

    log.info("[clipboardPopup] 窗口创建成功");
    return win;
  }
}
