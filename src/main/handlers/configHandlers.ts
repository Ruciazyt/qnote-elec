import { ipcMain } from "electron";
import { configManager } from "../utils/config";
import { setBaiduKeys } from "../utils/baiduOCR";
import { log } from "../utils/log";
import { app } from "electron";

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
}

