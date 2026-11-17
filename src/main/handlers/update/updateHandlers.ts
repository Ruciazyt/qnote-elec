import { ipcMain, shell } from "electron";
import { log } from "../../core/system/log";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateEnvironment,
  getUpdateStatus,
  installUpdate,
  RELEASES_PAGE_URL,
} from "../../core/update/updater";

export function registerUpdateHandlers() {
  ipcMain.handle("update:status", async () => {
    return getUpdateStatus();
  });

  ipcMain.handle("update:environment", async () => {
    return getUpdateEnvironment();
  });

  ipcMain.handle("update:check", async () => {
    try {
      return await checkForUpdates();
    } catch (err) {
      log.error("[update] 检查更新失败:", err);
      return getUpdateStatus();
    }
  });

  ipcMain.handle("update:download", async () => {
    try {
      return await downloadUpdate();
    } catch (err) {
      log.error("[update] 下载更新失败:", err);
      return getUpdateStatus();
    }
  });

  ipcMain.handle("update:install", async () => {
    return installUpdate();
  });

  ipcMain.handle("update:open-releases", async () => {
    try {
      await shell.openExternal(RELEASES_PAGE_URL);
      return true;
    } catch (err) {
      log.error("[update] 打开下载页面失败:", err);
      return false;
    }
  });
}
