import { ipcMain } from "electron";
import { log } from "../../core/system/log";
import { getMainWindow } from "../../core/window/mainWindow";
import { dialogWindowManager } from "../../core/window/apps/dialogWindow";
import {
  DIALOG_CLOSE_ACTIONS,
  type DialogContext,
  type DialogMessage,
} from "../../../shared/apps/dialogTypes";

export function registerDialogHandlers(): void {
  ipcMain.handle(
    "dialog:open",
    async (_event, context: DialogContext): Promise<{ ok: boolean; error?: string }> => {
      if (!context?.type) {
        return { ok: false, error: "缺少弹框类型" };
      }
      dialogWindowManager.open(context.type, context.payload ?? {});
      return { ok: true };
    }
  );

  ipcMain.handle("dialog:context-get", async () => dialogWindowManager.getContext());

  ipcMain.handle("dialog:close", async () => {
    dialogWindowManager.close();
    return { ok: true };
  });

  ipcMain.on("dialog:message", (_event, message: DialogMessage) => {
    const action = String(message?.action ?? "");
    if (!action) return;

    if (DIALOG_CLOSE_ACTIONS.includes(action)) {
      dialogWindowManager.close();
    }

    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send("dialog:message", {
        action,
        payload: message.payload ?? {},
      });
    }
  });

  log.info("弹框窗口 IPC 处理器已注册");
}
