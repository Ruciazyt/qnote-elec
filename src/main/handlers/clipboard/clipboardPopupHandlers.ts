import { ipcMain, clipboard, nativeImage } from "electron";
import { writeClipboardImage } from "../../utils/clipboard";
import { log } from "../../core/system/log";
import { getDB } from "../../../database/index";
import { markClipboardSelfWrite, markClipboardSelfWriteImage } from "../../core/clipboard/clipboardListener";

export function registerClipboardPopupHandlers() {
  ipcMain.handle("popup-get-clipboard-history", async (_event, limit = 20) => {
    try {
      const db = getDB();
      const rows = await db
        .select("*")
        .from("note")
        .orderByRaw("COALESCE(pinned_at, 0) DESC, created_at DESC")
        .limit(limit);
      return rows.map((row: any) => ({
        id: row.id,
        type: row.type || "text",
        content: row.content,
        time: row.created_at ? new Date(row.created_at).toISOString() : "",
      }));
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

  ipcMain.handle("mark-clipboard-self-write", (_event, content: string) => {
    if (typeof content !== "string" || content.length === 0) return false;
    markClipboardSelfWrite(content);
    return true;
  });
}
