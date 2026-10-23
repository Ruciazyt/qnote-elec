import { BrowserWindow, ipcMain, screen } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { app } from "electron";
import { log } from "../../utils/log";

let circleWin: BrowserWindow | null = null;
// 存储IPC监听器引用，用于清理
let circleClickHandler: ((...args: any[]) => void) | null = null;

function getAssetsDir() {
  return !app.isPackaged
    ? path.join(app.getAppPath(), "..", "..", "resources")
    : path.join(process.resourcesPath, "resources");
}

function resolveAssetPath(fileName: string) {
  return path.join(getAssetsDir(), fileName);
}

export function createCircleWindow(): BrowserWindow {
  log.info("开始创建圆形控件窗口...");

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  log.info("屏幕尺寸:", { width, height });

  circleWin = new BrowserWindow({
    width: 50,
    height: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    x: width - 70,
    y: height - 70,
    show: false, // 初始时不显示
  });

  log.info("圆形控件窗口已创建");

  // 加载圆形控件的HTML
  const circleHtmlPath = resolveAssetPath("circle.html");
  log.info("圆形控件HTML路径:", circleHtmlPath);

  // 检查HTML文件是否存在
  if (!fs.existsSync(circleHtmlPath)) {
    throw new Error(`圆形控件HTML文件不存在: ${circleHtmlPath}`);
  }

  // 监听加载失败事件
  circleWin.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error(`圆形控件加载失败: ${errorCode} - ${errorDescription}`);
  });

  // 监听加载成功事件
  circleWin.webContents.on('did-finish-load', () => {
    log.info("圆形控件HTML加载完成");
  });

  // loadFile 返回的 Promise 在加载失败时会 reject。
  // 上面已有 did-fail-load 监听负责上报加载失败，这里再接住 reject，
  // 免得它落到全局兜底变成一句无上下文的"未处理的Promise拒绝"。
  circleWin.loadFile(circleHtmlPath).catch((error) => {
    log.error("圆形控件加载失败:", error);
  });

  // 允许拖拽
  circleWin.setMovable(true);

  // 点击事件 - 使用命名函数以便移除
  circleClickHandler = () => {
    log.info("圆形控件被点击");
    // 显示主窗口
    const { getMainWindow } = require('./mainWindow');
    const mainWin = getMainWindow();
    if (mainWin) {
      mainWin.setSkipTaskbar(false);
      mainWin.show();
      circleWin?.hide();
    }
  };
  ipcMain.on("circle-click", circleClickHandler);

  log.info("圆形控件窗口创建完成");

  return circleWin;
}

export function getCircleWindow(): BrowserWindow | null {
  return circleWin;
}

// 清理圆形控件窗口资源
export function destroyCircleWindow(): void {
  if (circleClickHandler) {
    ipcMain.removeListener("circle-click", circleClickHandler);
    circleClickHandler = null;
  }
  if (circleWin) {
    circleWin.removeAllListeners();
    circleWin.destroy();
    circleWin = null;
    log.info("圆形控件窗口已销毁");
  }
}
