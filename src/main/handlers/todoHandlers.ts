import { ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../utils/log";

/** 附件类型 — 当前仅支持 image（基于 base64 dataUrl） */
export type TodoAttachmentType = "image";

export interface TodoAttachment {
  /** 唯一 id（前端生成） */
  id: string;
  type: TodoAttachmentType;
  /** 图片 base64 data URL，形如 `data:image/png;base64,...` */
  dataUrl: string;
  /** 可选原文件名 */
  name?: string;
}

export interface TodoRow {
  id: number;
  title: string;
  notes: string | null;
  priority: "high" | "medium" | "low";
  due_date: string | null;
  completed: 0 | 1;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** 附件列表 */
  attachments: TodoAttachment[];
}

export interface TodoInput {
  title: string;
  notes?: string;
  priority?: "high" | "medium" | "low";
  due_date?: string | null;
  attachments?: TodoAttachment[];
}

export interface TodoUpdateInput {
  title?: string;
  notes?: string | null;
  priority?: "high" | "medium" | "low";
  due_date?: string | null;
  attachments?: TodoAttachment[];
}

/**
 * 解析 attachments 字段为数组
 * 兼容：null / undefined / 非法 JSON / 旧版本无此字段的情况
 */
function parseAttachments(raw: unknown): TodoAttachment[] {
  if (!raw) return [];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 简单校验每项必填字段
    return parsed.filter(
      (item): item is TodoAttachment =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.dataUrl === "string" &&
        item.dataUrl.startsWith("data:image/") &&
        (item.type === undefined || item.type === "image")
    );
  } catch (err) {
    log.warn("解析 todo attachments 字段失败", err);
    return [];
  }
}

/** 将附件列表序列化为 JSON 字符串用于存储 */
function serializeAttachments(items: TodoAttachment[] | undefined): string {
  if (!items || items.length === 0) return "[]";
  // 仅保留必要字段，避免存储垃圾数据
  const safe = items
    .filter((item) => item && item.id && item.dataUrl && item.dataUrl.startsWith("data:image/"))
    .map((item) => ({
      id: item.id,
      type: "image" as const,
      dataUrl: item.dataUrl,
      name: item.name,
    }));
  return JSON.stringify(safe);
}

function serializeTodo(row: any): TodoRow {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    priority: (row.priority as TodoRow["priority"]) || "medium",
    due_date: row.due_date ?? null,
    completed: row.completed ? 1 : 0,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attachments: parseAttachments(row.attachments),
  };
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function registerTodoHandlers(DB: any) {
  ipcMain.handle("todo:list", async () => {
    try {
      const rows = await DB.from("todo").select("*");
      const items = rows.map(serializeTodo);
      // 排序：未完成按优先级（高→低）+ 截止日期升序（无截止日期排最后）+ 创建时间倒序；
      // 已完成按完成时间倒序
      items.sort((a, b) => {
        if (a.completed !== b.completed) {
          return a.completed - b.completed;
        }
        if (a.completed === 1) {
          const at = a.completed_at ? new Date(a.completed_at).getTime() : 0;
          const bt = b.completed_at ? new Date(b.completed_at).getTime() : 0;
          return bt - at;
        }
        const pa = PRIORITY_RANK[a.priority] ?? 1;
        const pb = PRIORITY_RANK[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return items;
    } catch (err) {
      log.error("获取Todo列表失败", err);
      return [];
    }
  });

  ipcMain.handle("todo:create", async (_event: IpcMainInvokeEvent, input: TodoInput) => {
    try {
      const now = new Date();
      const payload = {
        title: input.title.trim(),
        notes: input.notes ?? null,
        priority: input.priority ?? "medium",
        due_date: input.due_date ?? null,
        completed: 0,
        completed_at: null,
        created_at: now,
        updated_at: now,
        attachments: serializeAttachments(input.attachments),
      };
      const [row] = await DB.from("todo").insert(payload).returning("*");
      return serializeTodo(row);
    } catch (err) {
      log.error("创建Todo失败", err);
      throw err;
    }
  });

  ipcMain.handle("todo:update", async (_event: IpcMainInvokeEvent, id: number, patch: TodoUpdateInput) => {
    try {
      const update: Record<string, unknown> = { updated_at: new Date() };
      if (patch.title !== undefined) update.title = patch.title.trim();
      if (patch.notes !== undefined) update.notes = patch.notes;
      if (patch.priority !== undefined) update.priority = patch.priority;
      if (patch.due_date !== undefined) update.due_date = patch.due_date;
      if (patch.attachments !== undefined) update.attachments = serializeAttachments(patch.attachments);
      const [row] = await DB.from("todo").where("id", id).update(update).returning("*");
      return serializeTodo(row);
    } catch (err) {
      log.error("更新Todo失败", err);
      throw err;
    }
  });

  ipcMain.handle("todo:delete", async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      const removed = await DB.from("todo").where("id", id).delete();
      return removed > 0;
    } catch (err) {
      log.error("删除Todo失败", err);
      return false;
    }
  });

  ipcMain.handle("todo:toggle", async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      const existing = await DB.from("todo").where("id", id).first();
      if (!existing) {
        throw new Error(`Todo ${id} 不存在`);
      }
      const wasCompleted = !!existing.completed;
      const now = new Date();
      const [row] = await DB.from("todo").where("id", id).update({
        completed: wasCompleted ? 0 : 1,
        completed_at: wasCompleted ? null : now,
        updated_at: now,
      }).returning("*");
      return serializeTodo(row);
    } catch (err) {
      log.error("切换Todo状态失败", err);
      throw err;
    }
  });
}