import { ipcMain } from "electron";
import { configManager } from "../utils/config";
import { setBaiduKeys } from "../utils/baiduOCR";
import { log } from "../utils/log";
import { app } from "electron";
import { isClipboardPanelPosition } from "../../shared/clipboardPanel";

// 注：原先这里有一个 get-latest-release handler，用 GitHub API 查最新版本号。
// 它已被 src/main/core/updater.ts 的 electron-updater 方案取代并删除，原因是：
//   1. 只能拿到版本号，既下载不了安装包也装不了；
//   2. 匿名访问 GitHub API 对非公开仓库直接返回 404，"检查更新"永远失败。
// 现在的更新能力统一走 update:* 系列通道，见 handlers/updateHandlers.ts。

export function registerConfigHandlers() {
  ipcMain.handle("get-baidu-keys", async () => {
    return configManager.getBaiduKeys();
  });

  ipcMain.handle("set-baidu-keys", async (_event, apiKey: string, secretKey: string) => {
    try {
      await configManager.setBaiduKeys(apiKey, secretKey);
      setBaiduKeys(apiKey, secretKey);
      log.info("百度OCR密钥已更新");
      return { success: true };
    } catch (error) {
      log.error("设置百度OCR密钥失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("get-app-info", async () => {
    try {
      return {
        productName: app.getName(),
        dataPath: configManager.getDataPath(),
        configPath: configManager.getConfigPath(),
        version: app.getVersion(),
        appPath: app.getAppPath(),
        exePath: app.getPath('exe')
      };
    } catch (error) {
      log.error("获取应用信息失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** 读取剪贴板面板的展示位置（底部横排 / 侧边竖排） */
  ipcMain.handle("clipboard-panel:get-position", async () => {
    try {
      const position = await configManager.getClipboardPanelPosition();
      return { ok: true, position };
    } catch (error) {
      log.error("读取剪贴板面板位置失败", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /** 保存剪贴板面板的展示位置 */
  ipcMain.handle("clipboard-panel:set-position", async (_event, position: unknown) => {
    // 落库前先验合法性：这个值直接决定窗口坐标与尺寸，
    // 脏值会让面板跑到屏幕外面
    if (!isClipboardPanelPosition(position)) {
      return { ok: false, error: "无效的面板位置" };
    }
    try {
      await configManager.setClipboardPanelPosition(position);
      return { ok: true };
    } catch (error) {
      log.error("保存剪贴板面板位置失败", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

