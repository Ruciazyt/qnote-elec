import { ipcMain, shell } from "electron";
import { log } from "../utils/log";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateEnvironment,
  getUpdateStatus,
  installUpdate,
  RELEASES_PAGE_URL,
} from "../core/updater";

/**
 * 更新相关的 IPC 处理器
 *
 * 通道命名统一用 "update:" 前缀，和项目里既有的 "notes:" / "floating-ai:"
 * 风格保持一致。
 */
export function registerUpdateHandlers() {
  /** 当前更新状态快照 —— 渲染层挂载时先拉一次，避免闪烁到默认文案 */
  ipcMain.handle("update:status", async () => {
    return getUpdateStatus();
  });

  /** 运行环境信息：是否打包版、是否便携版、下载地址 */
  ipcMain.handle("update:environment", async () => {
    return getUpdateEnvironment();
  });

  /** 手动检查更新 */
  ipcMain.handle("update:check", async () => {
    try {
      return await checkForUpdates();
    } catch (err) {
      log.error("[update] 检查更新失败:", err);
      return getUpdateStatus();
    }
  });

  /** 下载更新包 */
  ipcMain.handle("update:download", async () => {
    try {
      return await downloadUpdate();
    } catch (err) {
      log.error("[update] 下载更新失败:", err);
      return getUpdateStatus();
    }
  });

  /** 重启并安装更新 —— 调用后应用会退出，没有返回值 */
  ipcMain.handle("update:install", async () => {
    return installUpdate();
  });

  /**
   * 打开 Releases 页面
   *
   * 自动更新不可用时（便携版、更新源不可达）给用户一条手动出路，
   * 总不能让"检查更新"变成一个只会说"失败"的按钮。
   */
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
