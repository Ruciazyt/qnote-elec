import { BrowserWindow, screen, ipcMain } from "electron";
import * as path from "node:path";
import { app } from "electron";
import { log } from "../../utils/log";
import { stickyNoteManager } from "./stickyNote";
import { hideMainWindow, showMainWindow } from "./mainWindow";
import { configManager } from "../../utils/config";
import {
  clipboardPanelWindowSize,
  type ClipboardPanelPosition,
} from "../../../shared/clipboardPanel";

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

function getPreloadPath() {
  return path.join(__dirname, "..", "..", "preload.js");
}

/** 面板与屏幕边缘的留白 */
const SCREEN_MARGIN = 40;

/**
 * 窗口的位置与尺寸
 *
 * 贴着光标所在显示器的工作区算：
 *   - 底部：水平居中、贴工作区下沿（和系统 Win+V 的观感一致）
 *   - 侧边：贴工作区右沿、垂直居中
 *
 * 屏幕不够大时按可用空间压缩，而不是让面板超出屏幕被系统裁掉。
 */
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
  /** 页面是否已经渲染完成（首次 ready-to-show 之后为 true） */
  private ready = false;

  static getInstance(): ClipboardPopupWindow {
    if (!ClipboardPopupWindow.instance) {
      ClipboardPopupWindow.instance = new ClipboardPopupWindow();
    }
    return ClipboardPopupWindow.instance;
  }

  /**
   * 显示面板
   *
   * 流程：读位置配置 → 摆窗口 → 主窗口让位 → 显示 → 通知渲染层刷新。
   *
   * 主窗口必须让位：这个面板是「随手看一眼」的浮层，压在主窗口上面
   * 既挡视线又会互相抢焦点。关掉面板后主窗口不自动回来 —— 唤回入口
   * 是托盘图标和全局快捷键，自动弹回来反而打断用户正在做的事。
   */
  async show(): Promise<void> {
    const position = await configManager.getClipboardPanelPosition();
    // create() 只负责造窗口，实例状态还得自己接上 —— 漏了这句
    // this.win 永远是 null，后面整段逻辑都不执行
    if (!this.win) this.win = this.create();
    const win = this.win;
    if (!win || win.isDestroyed()) return;

    win.setBounds(panelBounds(position), false);
    hideMainWindow();

    if (this.ready) {
      win.show();
      win.focus();
      // 复用同一个窗口，第二次唤出时渲染层手里还是旧数据 —— 推一条刷新指令
      win.webContents.send("popup:refresh");
    }
    // 首次显示由 ready-to-show 回调接手（见 create），避免闪一帧空白
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
      // 系统原生阴影是方的，跟面板的圆角对不上 —— 阴影交给 CSS 画
      hasShadow: false,
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
      win.loadURL(`${DEV_SERVER_URL}/popup-clipboard.html`).catch((error) => {
        log.error("[clipboardPopup] 加载开发服务器页面失败:", error);
      });
    } else {
      // 生产环境：使用构建后的 HTML 文件
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

    // 首次渲染完成再显示，避免白屏闪一下
    win.once("ready-to-show", () => {
      this.ready = true;
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });

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
      // 先收面板，再把主窗口叫回来 —— 两个窗口同时在前台会互相抢焦点
      this.hide();
      showMainWindow();
    };
    ipcMain.on("popup-show-main-window", popupShowMainWindowHandler);
    ipcListenerRefs.push({ channel: "popup-show-main-window", handler: popupShowMainWindowHandler });

    log.info("[clipboardPopup] 窗口创建成功");
    return win;
  }
}
