import * as fs from "node:fs";
import * as path from "node:path";
import type { Knex } from "knex";
import { NoteStore } from "../../notes/noteStore";
import { getToolContext } from "../../ai/toolContext";
import { aiService } from "../../ai/aiService";
import { configManager } from "../../system/config";
import type { AiMessage, AiProvider } from "../../ai/types";
import { detectNoteType } from "../../../../shared/notes/noteTypes";

const TODO_PRIORITIES = ["high", "medium", "low"];

export interface NoteWriteResult {
  relPath: string;
  name: string;
  type: string;
  bytes: number;
}

export async function resolveNoteRoot(): Promise<string> {
  let root: string | undefined;
  try {
    root = await getToolContext().notes?.getFilePath();
  } catch {
    throw new Error("笔记功能还没初始化");
  }
  if (!root) throw new Error("用户还没有设置笔记保存目录");
  return root;
}

export async function listTodos(
  DB: Knex,
  params: Record<string, unknown>
): Promise<{ count: number; items: unknown[] }> {
  const limit = Math.min(Math.max(Number(params.limit ?? 20) || 20, 1), 100);
  const rows = await DB("todo")
    .select(
      "id",
      "title",
      "notes",
      "priority",
      "completed",
      "due_date",
      "remind_at",
      "created_at",
      "archived_at"
    )
    .whereNull("archived_at")
    .orderBy("created_at", "desc")
    .limit(limit);
  return { count: rows.length, items: rows };
}

export async function createTodo(
  DB: Knex,
  params: Record<string, unknown>
): Promise<{ id: number; title: string }> {
  const title = String(params.title ?? "").trim();
  if (!title) throw new Error("待办标题不能为空");

  const priority = String(params.priority ?? "medium");
  if (!TODO_PRIORITIES.includes(priority)) {
    throw new Error(`待办优先级只能是 ${TODO_PRIORITIES.join(" / ")}`);
  }

  const now = new Date();
  const row = {
    title,
    notes: params.notes === undefined ? null : String(params.notes ?? ""),
    priority,
    due_date: params.dueDate ? String(params.dueDate) : null,
    completed: 0,
    completed_at: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
  };

  const inserted = await DB("todo").insert(row);
  const id = Number(inserted[0] ?? 0);
  await notifyTodosChanged();
  return { id, title };
}

export async function updateTodo(
  DB: Knex,
  params: Record<string, unknown>
): Promise<{ id: number; updated: boolean }> {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Error("待办 id 不能为空");

  const existing = await DB("todo").where("id", id).first();
  if (!existing) throw new Error(`待办 ${id} 不存在`);

  const update: Record<string, unknown> = { updated_at: new Date() };
  if (params.title !== undefined) {
    const title = String(params.title ?? "").trim();
    if (!title) throw new Error("待办标题不能为空");
    update.title = title;
  }
  if (params.notes !== undefined) update.notes = String(params.notes ?? "");
  if (params.priority !== undefined) {
    const priority = String(params.priority);
    if (!TODO_PRIORITIES.includes(priority)) {
      throw new Error(`待办优先级只能是 ${TODO_PRIORITIES.join(" / ")}`);
    }
    update.priority = priority;
  }
  if (params.dueDate !== undefined) {
    update.due_date = params.dueDate ? String(params.dueDate) : null;
  }
  if (params.completed !== undefined) {
    const completed = Boolean(params.completed);
    update.completed = completed ? 1 : 0;
    update.completed_at = completed ? new Date() : null;
  }

  await DB("todo").where("id", id).update(update);
  await notifyTodosChanged();
  return { id, updated: true };
}

export async function listClipboard(
  DB: Knex,
  params: Record<string, unknown>
): Promise<{ count: number; items: unknown[] }> {
  const limit = Math.min(Math.max(Number(params.limit ?? 10) || 10, 1), 50);
  const type = params.type ? String(params.type) : "";

  let query = DB("note")
    .select("id", "content", "type", "ocr_result", "created_at")
    .orderBy("created_at", "desc")
    .limit(limit);
  if (type) query = query.where("type", type);

  const rows = await query;
  const items = rows.map((row: Record<string, unknown>) => ({
    id: row.id,
    type: row.type || "text",
    content: row.type === "image" && row.ocr_result ? row.ocr_result : row.content,
    created_at: row.created_at,
  }));
  return { count: items.length, items };
}

export async function listNotes(
  root: string,
  params: Record<string, unknown>
): Promise<{ count: number; items: unknown[]; root: string }> {
  const limit = Math.min(Math.max(Number(params.limit ?? 50) || 50, 1), 500);
  const store = new NoteStore();
  const all = await store.scanFiles(root, {
    maxDirs: 2000,
    maxFiles: 5000,
    deadlineMs: 5000,
  });
  const items = all.slice(0, limit).map((note) => ({
    relPath: note.relPath,
    name: note.name,
    type: note.type,
    ext: note.ext,
    size: note.size,
    mtime: note.mtime,
  }));
  return { count: items.length, items, root };
}

export async function getNote(
  root: string,
  relPath: string
): Promise<{ relPath: string; name: string; type: string; content: string }> {
  const target = String(relPath ?? "").trim();
  if (!target) throw new Error("笔记路径不能为空");

  const store = new NoteStore();
  const content = store.read(root, target);
  if (content.type !== "markdown" && content.type !== "html") {
    throw new Error(`${target} 不是文本笔记，读不出正文`);
  }
  return {
    relPath: target,
    name: content.name,
    type: content.type,
    content: content.text ?? "",
  };
}

export async function createNote(
  root: string,
  params: Record<string, unknown>
): Promise<NoteWriteResult> {
  const title = String(params.title ?? "").trim();
  if (!title) throw new Error("笔记标题不能为空");

  const type = params.type === "html" ? "html" : "markdown";
  const folder = normalizeFolder(params.folder);

  const store = new NoteStore();
  const created = store.createNoteFile(root, folder, title, type);
  if (created.ok === false) throw new Error(created.reason);

  const content = String(params.content ?? "");
  const written =
    type === "html"
      ? store.writeHtmlWithAssets(root, created.relPath, content)
      : store.writeMarkdownWithAssets(root, created.relPath, content);
  if (!written) throw new Error(`写入失败：${created.relPath}`);

  await notifyNotesChanged(root);
  const entry = store.stat(root, created.relPath);
  return {
    relPath: created.relPath,
    name: entry?.name ?? path.posix.basename(created.relPath),
    type,
    bytes: entry?.size ?? content.length,
  };
}

export async function updateNote(
  root: string,
  params: Record<string, unknown>
): Promise<NoteWriteResult> {
  const relPath = String(params.path ?? "").trim();
  if (!relPath) throw new Error("笔记路径不能为空");
  if (params.content === undefined) throw new Error("笔记内容不能为空");

  const type = detectNoteType(path.posix.basename(relPath));
  if (type !== "markdown" && type !== "html") {
    throw new Error(`${relPath} 不是可写的文本笔记`);
  }

  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(path.resolve(root))) {
    throw new Error("目标路径超出了笔记目录范围，已拒绝写入");
  }
  if (!fs.existsSync(abs)) throw new Error(`${relPath} 不存在`);

  const content = String(params.content ?? "");
  const store = new NoteStore();
  const written =
    type === "html"
      ? store.writeHtmlWithAssets(root, relPath, content)
      : store.writeMarkdownWithAssets(root, relPath, content);
  if (!written) throw new Error(`写入失败：${relPath}`);

  await notifyNotesChanged(root);
  const entry = store.stat(root, relPath);
  return {
    relPath,
    name: entry?.name ?? path.posix.basename(relPath),
    type,
    bytes: entry?.size ?? content.length,
  };
}

export async function chatWithAi(
  params: Record<string, unknown>
): Promise<{ content: string; model?: string; usage?: unknown }> {
  const aiConfig = await configManager.getAiConfig();
  if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) {
    throw new Error("请先在设置中配置 AI API Key");
  }

  const messages = buildAiMessages(params);
  if (messages.length === 0) throw new Error("发给 AI 的内容不能为空");

  const response = await aiService.sendMessage(messages, {
    provider: aiConfig.provider as AiProvider,
    apiKey: aiConfig.apiKey,
    model: aiConfig.model,
    baseUrl: aiConfig.baseUrl,
  });

  return { content: response.content, model: response.model, usage: response.usage };
}

function normalizeFolder(raw: unknown): string {
  const folder = String(raw ?? "").trim().replace(/[\\/:*?"<>|]/g, "").trim();
  if (!folder) return "";
  if (folder === "." || folder === "..") {
    throw new Error("folder 只支持单层文件夹名");
  }
  return folder;
}

function buildAiMessages(params: Record<string, unknown>): AiMessage[] {
  const messages: AiMessage[] = [];
  const system = String(params.system ?? "").trim();
  if (system) messages.push({ role: "system", content: system });

  const raw = params.messages;
  if (Array.isArray(raw) && raw.length > 0) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const role = String(entry.role ?? "user");
      const content = String(entry.content ?? "");
      if (!content) continue;
      if (role !== "user" && role !== "assistant" && role !== "system") continue;
      messages.push({ role, content });
    }
    return messages;
  }

  const text = String(params.message ?? "").trim();
  if (text) messages.push({ role: "user", content: text });
  return messages;
}

async function notifyTodosChanged(): Promise<void> {
  try {
    const { broadcastTodosChanged } = await import("../../../handlers/todo/todoHandlers");
    broadcastTodosChanged();
  } catch {
  }
}

async function notifyNotesChanged(root: string): Promise<void> {
  try {
    const { broadcastNotesChanged } = await import("../../../handlers/notes/fileHandlers");
    broadcastNotesChanged(root);
  } catch {
  }
}
