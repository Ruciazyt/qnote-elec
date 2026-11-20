import { BrowserWindow, app } from "electron";
import * as path from "node:path";
import { log } from "../../system/log";
import { getPreloadPath } from "../../../utils/paths";
import { getMainWindow } from "../mainWindow";
import type { DialogContext } from "../../../../shared/plugin/dialogTypes";

const DEV_SERVER_URL = "http://localhost:5173";

export class DialogWindowManager {
  private win: BrowserWindow | null = null;
  private context: DialogContext | null = null;
  private detachParent: (() => void) | null = null;
  private ready = false;
  private pendingShow = false;

  open(type: DialogContext["type"], payload: Record<string, unknown>): void {
    this.context = { type, payload };
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create();
    }
    const win = this.win;
    if (!win) return;
    this.syncBounds();
    win.webContents.send("dialog:context", this.context);
    if (this.ready) {
      win.show();
      win.focus();
    } else {
      this.pendingShow = true;
    }
  }

  close(): void {
    this.context = null;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    win.hide();
  }

  dispose(): void {
    this.detachParent?.();
    this.detachParent = null;
    this.context = null;
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  getContext(): DialogContext | null {
    return this.context;
  }

  isOpen(): boolean {
    const win = this.win;
    return Boolean(win && !win.isDestroyed() && win.isVisible());
  }

  private create(): BrowserWindow {
    const parent = getMainWindow();
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
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
      win.loadURL(`${DEV_SERVER_URL}/dialog.html`).catch((error) => {
        log.error("[dialog] 加载开发服务器页面失败:", error);
      });
    } else {
      const htmlPath = path.join(
        process.resourcesPath,
        "renderer",
        "dist",
        "dialog.html"
      );
      log.info("[dialog] 加载 HTML:", htmlPath);
      win.loadFile(htmlPath).catch((error) => {
        log.error("[dialog] 加载 HTML 失败:", error);
      });
    }

    const sync = () => this.syncBounds();
    if (parent && !parent.isDestroyed()) {
      parent.on("move", sync);
      parent.on("resize", sync);
      this.detachParent = () => {
        parent.removeListener("move", sync);
        parent.removeListener("resize", sync);
      };
    }

    win.webContents.once("did-finish-load", () => {
      this.ready = true;
      if (!this.pendingShow) return;
      this.pendingShow = false;
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });

    win.on("closed", () => {
      this.detachParent?.();
      this.detachParent = null;
      this.win = null;
      this.context = null;
      this.ready = false;
      this.pendingShow = false;
      log.info("[dialog] 弹框窗口已关闭");
    });

    log.info("[dialog] 弹框窗口创建成功");
    return win;
  }

  private syncBounds(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const parent = getMainWindow();
    if (!parent || parent.isDestroyed()) return;
    const { x, y, width, height } = parent.getContentBounds();
    win.setContentBounds({ x, y, width, height });
  }
}

export const dialogWindowManager = new DialogWindowManager();
