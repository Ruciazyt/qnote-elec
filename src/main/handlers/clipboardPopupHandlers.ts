import { ipcMain, clipboard, nativeImage } from "electron";
import { writeClipboardImage } from "../utils/clipboard";
import { log } from "../utils/log";
import { getDB } from "../../database";
import { markClipboardSelfWrite, markClipboardSelfWriteImage } from "../core/clipboardListener";

export function registerClipboardPopupHandlers() {
  ipcMain.handle("popup-get-clipboard-history", async (_event, limit = 20) => {
    try {
      const db = getDB();
      const rows = await db.select("*").from("note").orderByRaw("COALESCE(pinned_at, 0) DESC, created_at DESC").limit(limit);
      return rows;
    } catch (err) {
      log.error("popup-get-clipboard-history error:", err);
      return [];
    }
  });

  ipcMain.handle("popup-copy-clipboard-item", async (_event, itemId: number) => {
    try {
      const db = getDB();
      const item = await db.from("note").where("id", itemId).first();
      if (!item) return { success: false, error: "Item not found" };

      if (item.type === "text") {
        // 先登记再写：应用内复制出来的内容不再被监听器记成一条新的历史
        markClipboardSelfWrite(item.content);
        await clipboard.writeText(item.content);
      } else if (item.type === "image") {
        const imagePath = item.content;
        const img = nativeImage.createFromPath(imagePath);
        if (img.isEmpty()) {
          return { success: false, error: "图片不存在或已损坏" };
        }
        markClipboardSelfWriteImage(img);
        await writeClipboardImage(img);
      }
      return { success: true };
    } catch (err: any) {
      log.error("popup-copy-clipboard-item error:", err);
      return { success: false, error: err.message };
    }
  });

  /**
   * 渲染层写剪贴板前先登记，监听器据此跳过，不再重复记录。
   *
   * 渲染层的 navigator.clipboard.writeText 走的是 Chromium，不经过主进程，
   * 所以主进程无法自动感知 —— 必须由渲染层在写入**之前**通知一次。
   * 顺序不能反：先通知再写，登记一定早于内容变化，监听器不可能读到未登记的新内容。
   */
  ipcMain.handle("mark-clipboard-self-write", (_event, content: string) => {
    if (typeof content !== "string" || content.length === 0) return false;
    markClipboardSelfWrite(content);
    return true;
  });
}
