import { ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../../core/system/log";
import { contentHash } from "../../../shared/notes/noteHash";
import { describeDBError } from "../../../database/index";

async function clearNoteIndexRows(DB: any, ids: number[]): Promise<void> {
  if (!ids.length) return;
  try {
    await DB.from("vector_store").whereIn("note_id", ids).delete();
    await DB.from("memory_store").whereIn("note_id", ids).delete();
  } catch (err) {
    log.error("清理笔记的向量与记忆索引失败", err);
  }
}

export function registerNoteHandlers(DB: any) {
  const LIST_ORDER = "COALESCE(pinned_at, 0) DESC, created_at DESC";

  function toRecord(record: any) {
    return {
      id: record.id,
      type: record.type || "text",
      content: record.content,
      time: new Date(record.created_at),
      ocr_result: record.ocr_result || "",
      vector_indexed: record.vector_indexed || 0,
      vector_id: record.vector_id || "",
      pinned_at: record.pinned_at ?? null,
      is_important: record.is_important || 0,
    };
  }

  ipcMain.handle("get-clipboard-history", async () => {
    try {
      const records = await DB.select("*").from("note").orderByRaw(LIST_ORDER).limit(100);
      return records.map(toRecord);
    } catch (err) {
      log.error("获取剪贴板历史失败", err);
      return [];
    }
  });

  ipcMain.handle("delete-note-by-id", async (_event: any, id: number) => {
    try {
      await DB.from("note").where("id", id).delete();
      await clearNoteIndexRows(DB, [id]);
      return true;
    } catch (err) {
      log.error("删除笔记失败", err);
      return false;
    }
  });

  ipcMain.handle("delete-all-notes", async () => {
    try {
      try {
        const targets = DB.from("note")
          .whereNull("pinned_at")
          .where("is_important", 0)
          .select("id");
        await DB.from("vector_store").whereIn("note_id", targets).delete();
        await DB.from("memory_store").whereIn("note_id", targets).delete();
      } catch (err) {
        log.error("清理记忆索引失败", err);
      }
      const deleted = await DB.from("note")
        .whereNull("pinned_at")
        .where("is_important", 0)
        .delete();
      log.info(`[note] 清空记录，跳过置顶/重要，删除 ${deleted} 条`);
      return { success: true, deleted };
    } catch (err) {
      log.error("删除所有笔记失败", err);
      return { success: false, error: describeDBError(err) };
    }
  });

  ipcMain.handle("count-protected-notes", async () => {
    try {
      const row = await DB.from("note")
        .where((builder: any) =>
          builder.whereNotNull("pinned_at").orWhere("is_important", ">=", 1)
        )
        .count({ count: "*" })
        .first();
      const totalRow = await DB.from("note").count({ count: "*" }).first();
      const kept = Number(row?.count ?? 0);
      const total = Number(totalRow?.count ?? 0);
      return { kept, total, removable: Math.max(0, total - kept) };
    } catch (err) {
      log.error("统计受保护记录失败", err);
      return { kept: 0, total: 0, removable: 0 };
    }
  });

  ipcMain.handle("search-notes", async (event: IpcMainInvokeEvent, keyword: string) => {
    if (!keyword || !keyword.trim()) {
      return [];
    }
    try {
      const escapedKeyword = keyword.trim().replace(/[\\%_]/g, (ch) => "\\" + ch);
      const records = await DB.from("note")
        .select("*")
        .whereRaw("content LIKE ? ESCAPE '\\'", [`%${escapedKeyword}%`])
        .orderByRaw(LIST_ORDER)
        .limit(100);

      return records.map(toRecord);
    } catch (err) {
      log.error("搜索笔记失败", err);
      return [];
    }
  });

  ipcMain.handle("update-note-content", async (event: IpcMainInvokeEvent, noteId: number, content: string) => {
    try {
      await DB.from("note")
        .where("id", noteId)
        .update({
          content: content,
          content_hash: contentHash(content),
          updated_at: new Date().toISOString(),
        });
      log.info(`笔记 ${noteId} 内容已更新`);
      return { success: true };
    } catch (err) {
      log.error("更新笔记内容失败", err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("toggle-note-important", async (_event: any, noteId: number, important: boolean) => {
    try {
      await DB.from("note").where("id", noteId).update({ is_important: important ? 1 : 0 });
      return { success: true };
    } catch (err) {
      log.error("更新重要标记失败", err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("toggle-note-pin", async (_event: any, noteId: number, pinned: boolean) => {
    try {
      const pinnedAt = pinned ? Date.now() : null;
      await DB.from("note").where("id", noteId).update({ pinned_at: pinnedAt });
      return { success: true, pinned_at: pinnedAt };
    } catch (err) {
      log.error("更新置顶状态失败", err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

