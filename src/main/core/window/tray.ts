import { Tray, Menu, nativeImage, app } from "electron";
import { log } from "../../utils/log";
import { getTrayIconSize, resolveTrayIcons } from "../../utils/assets";

let tray: Tray | null = null;

function createTrayFromPath(iconPath: string): Tray {
  const iconImage = nativeImage.createFromPath(iconPath);
  if (iconImage.isEmpty()) {
    throw new Error(`无法加载图标文件: ${iconPath}`);
  }

  // 边长按平台取：Windows 任务栏是 16px，macOS 菜单栏是 16pt@2x = 32px。
  const size = getTrayIconSize();
  return new Tray(iconImage.resize({ width: size, height: size }));
}

export function createTray(): Tray | null {
  try {
    const iconPaths = resolveTrayIcons();
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
        label: "剪贴板面板",
        click: () => {
          // 全局快捷键在设置页可配，而任何组合都可能被别的程序占着
          // （系统保留键、其它软件注册的热键），注册失败时托盘菜单是兜底入口
          const { ClipboardPopupWindow } = require('./clipboardPopup');
          void ClipboardPopupWindow.getInstance()
            .show()
            .catch((err) => log.error("从托盘打开剪贴板面板失败", err));
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
