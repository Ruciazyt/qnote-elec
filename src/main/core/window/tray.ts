import { Tray, Menu, nativeImage, app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { log } from "../../utils/log";

let tray: Tray | null = null;

function getAssetDirs() {
  if (app.isPackaged) {
    return [path.join(process.resourcesPath, "resources")];
  }

  const appPath = app.getAppPath();
  return [
    path.join(appPath, "..", "..", "resources"),
    path.join(appPath, "..", "..", "src", "renderer", "public"),
  ];
}

function resolveExistingAssets(filenames: string[]): string[] {
  const candidates: string[] = [];

  for (const name of filenames) {
    for (const dir of getAssetDirs()) {
      const assetPath = path.join(dir, name);
      if (fs.existsSync(assetPath) && !candidates.includes(assetPath)) {
        candidates.push(assetPath);
      }
    }
  }

  return candidates;
}

function createTrayFromPath(iconPath: string): Tray {
  const iconImage = nativeImage.createFromPath(iconPath);
  if (iconImage.isEmpty()) {
    throw new Error(`无法加载图标文件: ${iconPath}`);
  }

  return new Tray(iconImage.resize({ width: 16, height: 16 }));
}

export function createTray(): Tray | null {
  try {
    const iconPaths = resolveExistingAssets(["icon.ico"]);
    if (iconPaths.length === 0) {
      log.warn("未找到托盘图标文件，跳过托盘初始化");
      return null;
    }

    let trayInstance: Tray | null = null;
    let lastError: unknown = null;

    for (const iconPath of iconPaths) {
      log.info("尝试创建托盘图标:", iconPath);

      try {
        trayInstance = createTrayFromPath(iconPath);
        log.info("托盘图标创建成功:", iconPath);
        break;
      } catch (error) {
        lastError = error;
        log.warn("托盘图标加载失败，尝试下一个候选图标", error);
      }
    }

    if (!trayInstance) {
      throw lastError instanceof Error
        ? lastError
        : new Error("未能加载任何可用的托盘图标");
    }

    tray = trayInstance;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "显示应用",
        click: () => {
          // 复用 mainWindow 的统一入口，托盘点击和菜单项行为才一致：
          // 最小化态要 restore，托盘隐藏态要补回被摘掉的图标。
          const { showMainWindow } = require('./mainWindow');
          showMainWindow();
        },
      },
      {
        label: "退出",
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setToolTip(app.getName());
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      const { showMainWindow } = require('./mainWindow');
      showMainWindow();
    });

    log.info("托盘菜单设置完成");
    return tray;
  } catch (err) {
    log.error("创建托盘图标失败", err);
    return null;
  }
}

export function getTray(): Tray | null {
  return tray;
}
