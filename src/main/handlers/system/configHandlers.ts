import { ipcMain, app } from "electron";
import { appVersion } from "../../core/system/appVersion";
import { configManager } from "../../core/system/config";
import { setBaiduKeys } from "../../core/ai/baiduOCR";
import { log } from "../../core/system/log";
import { isClipboardPanelPosition } from "../../../shared/clipboard/clipboardPanel";


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
        version: appVersion(),
        appPath: app.getAppPath(),
        exePath: app.getPath('exe')
      };
    } catch (error) {
      log.error("获取应用信息失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("clipboard-panel:get-position", async () => {
    try {
      const position = await configManager.getClipboardPanelPosition();
      return { ok: true, position };
    } catch (error) {
      log.error("读取剪贴板面板位置失败", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("clipboard-panel:set-position", async (_event, position: unknown) => {
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

