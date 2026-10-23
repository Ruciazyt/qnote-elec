import { ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../utils/log";
import { contentHash } from "../../shared/noteHash";

export function registerNoteHandlers(DB: any) {
  // 置顶的排最前，组内按置顶时间/记录时间倒序。
  // COALESCE 把未置顶的 NULL（以及历史脏数据里的 0）压成 0，明确排在所有真实时间戳之后。
  // 直接写 pinned_at DESC 也能work，但那是靠 SQLite「NULL 最小」这条隐式语义成立的，
  // 一旦列类型或引擎换了就会悄悄翻车。
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

  ipcMain.handle("delete-note", async (_event: any, content: string) => {
    try {
      await DB.from("note").where("content", content).delete();
      return true;
    } catch (err) {
      log.error("删除笔记失败", err);
      return false;
    }
  });

  ipcMain.handle("delete-note-by-id", async (_event: any, id: number) => {
    try {
      await DB.from("note").where("id", id).delete();
      return true;
    } catch (err) {
      log.error("删除笔记失败", err);
      return false;
    }
  });

  ipcMain.handle("delete-all-notes", async () => {
    try {
      // 置顶和标了重要的记录一律跳过 —— 「清空」清的是杂物，不是用户特意留下的东西
      const deleted = await DB.from("note")
        .whereNull("pinned_at")
        .where("is_important", 0)
        .delete();
      log.info(`[note] 清空记录，跳过置顶/重要，删除 ${deleted} 条`);
      return { success: true, deleted };
    } catch (err) {
      log.error("删除所有笔记失败", err);
      return { success: false };
    }
  });

  /**
   * 清空前先数一下会剩下多少条
   *
   * 给确认弹窗用。不先告诉用户「会保留 12 条」，他看到的还是「清空所有记录」，
   * 等真删完发现重要的还在，会以为功能坏了。
   */
  ipcMain.handle("count-protected-notes", async () => {
    try {
      // 「受保护」= 置顶 或 重要。
      // 注意是 whereNotNull 不是 whereNull —— whereNull("pinned_at") 单独用会匹配
      // 所有未置顶记录，把普通记录也算成受保护的（和删除口径正好对不上）。
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
      // Escape % and _ to prevent SQL LIKE wildcards from causing unexpected matches
      const escapedKeyword = keyword.trim().replace(/[%_]/g, "\\$&");
      const records = await DB.from("note")
        .select("*")
        .where("content", "like", `%${escapedKeyword}%`)
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
          // 剪贴板去重是拿 content_hash 走索引做的，正文一改哈希必须跟着改，
          // 否则这行的索引指向旧内容，再复制一次同样的文本会插出重复记录。
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

