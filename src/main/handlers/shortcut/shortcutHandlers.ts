import { ipcMain, dialog, shell, app, BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../../core/system/log";
import { describeDBError } from "../../../database/index";
import { getMainWindow } from "../../core/window/index";
import { resolveShortcutIcon, type ShortcutKind } from "../../core/shortcut/shortcutIcons";
import { getContextMenuStatus, setContextMenuEnabled, repairContextMenu } from "../../utils/shellContextMenu";

export interface ShortcutRow {
  id: number;
  kind: ShortcutKind;
  target: string;
  title: string;
  sort_order: number;
}

export interface ShortcutInput {
  kind: ShortcutKind;
  target: string;
  title?: string;
}

export interface ShortcutPickResult {
  kind: ShortcutKind;
  target: string;
  title: string;
}

const KINDS: ReadonlySet<string> = new Set(["url", "app", "folder"]);

const APP_EXTENSIONS = [".exe", ".lnk", ".bat", ".cmd"];

function coerceKind(value: unknown): ShortcutKind | null {
  return typeof value === "string" && KINDS.has(value) ? (value as ShortcutKind) : null;
}

export function inferShortcutKind(target: string): ShortcutKind {
  const trimmed = target.trim();
  if (/^https?:\/\//i.test(trimmed)) return "url";
  try {
    if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) return "folder"; // NOSONAR
  } catch {
  }
  return "app";
}

function deriveTitle(kind: ShortcutKind, target: string): string {
  if (kind === "url") {
    try {
      return new URL(target).host.replace(/^www\./, "") || target;
    } catch {
      return target;
    }
  }
  const base = path.basename(target.trim()).replace(/\.(exe|lnk|bat|cmd)$/i, "");
  return base || target;
}

function normalizeInput(input: ShortcutInput): ShortcutPickResult | { error: string } {
  const kind = coerceKind(input?.kind);
  if (!kind) return { error: "快捷方式类型不合法" };

  const target = (input?.target ?? "").trim();
  if (!target) return { error: "目标不能为空" };

  if (kind === "url") {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return { error: "网址格式不正确" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "只支持 http / https 网址" };
    }
    const title = (input?.title ?? "").trim() || deriveTitle(kind, parsed.toString());
    return { kind, target: parsed.toString(), title };
  }

  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return { error: "路径不存在" };

  let isDir = false;
  try {
    isDir = fs.statSync(abs).isDirectory(); // NOSONAR
  } catch {
    return { error: "无法读取该路径" };
  }

  if (kind === "folder" && !isDir) return { error: "这是一个文件，不是文件夹" };
  if (kind === "app" && isDir) return { error: "这是一个文件夹，请选择文件夹类型" };
  if (kind === "app" && !APP_EXTENSIONS.includes(path.extname(abs).toLowerCase())) {
    return { error: `只支持 ${APP_EXTENSIONS.join(" / ")} 类型的程序` };
  }

  const title = (input?.title ?? "").trim() || deriveTitle(kind, abs);
  return { kind, target: abs, title };
}

async function isDuplicate(DB: any, kind: ShortcutKind, target: string): Promise<boolean> {
  const row = await DB("shortcut").where("kind", kind).where("target", target).first();
  return !!row;
}

function broadcastShortcutsChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("shortcut:changed");
  }
}

export function registerShortcutHandlers(DB: any) {
  ipcMain.handle("shortcut:list", async (): Promise<ShortcutRow[]> => {
    try {
      const rows = await DB("shortcut").select("*").orderBy("sort_order", "asc").orderBy("id", "asc");
      return rows as ShortcutRow[];
    } catch (err) {
      log.error("shortcut:list error:", err);
      return [];
    }
  });

  ipcMain.handle(
    "shortcut:resolve-icon",
    async (_event, kind: string, target: string): Promise<string | null> => {
      try {
        const safeKind = coerceKind(kind);
        if (!safeKind || typeof target !== "string" || !target.trim()) return null;
        return await resolveShortcutIcon(safeKind, target);
      } catch (err) {
        log.error("shortcut:resolve-icon error:", err);
        return null;
      }
    }
  );

  ipcMain.handle(
    "shortcut:add",
    async (_event, input: ShortcutInput): Promise<{ success: boolean; error?: string; id?: number }> => {
      try {
        const normalized = normalizeInput(input);
        if ("error" in normalized) return { success: false, error: normalized.error };

        if (await isDuplicate(DB, normalized.kind, normalized.target)) {
          return { success: false, error: "这个快捷方式已经添加过了" };
        }

        const last = await DB("shortcut").orderBy("sort_order", "desc").orderBy("id", "desc").first();
        const nextOrder = Number(last?.sort_order ?? -1) + 1;

        const id = await DB("shortcut").insert({
          kind: normalized.kind,
          target: normalized.target,
          title: normalized.title,
          sort_order: nextOrder,
        });

        broadcastShortcutsChanged();
        return { success: true, id: id[0] };
      } catch (err) {
        log.error("shortcut:add error:", err);
        return { success: false, error: describeDBError(err) };
      }
    }
  );

  ipcMain.handle(
    "shortcut:update",
    async (
      _event,
      id: number,
      patch: { title?: string; target?: string }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const row = await DB("shortcut").where("id", id).first();
        if (!row) return { success: false, error: "快捷方式不存在" };

        const updates: Record<string, unknown> = { updated_at: new Date() };

        if (typeof patch?.title === "string") {
          const title = patch.title.trim();
          if (title) updates.title = title;
        }

        if (typeof patch?.target === "string" && patch.target.trim() !== row.target) {
          const normalized = normalizeInput({ kind: row.kind, target: patch.target });
          if ("error" in normalized) return { success: false, error: normalized.error };
          if (await isDuplicate(DB, normalized.kind, normalized.target)) {
            return { success: false, error: "这个快捷方式已经添加过了" };
          }
          updates.target = normalized.target;
          if (!patch.title?.trim()) updates.title = normalized.title;
        }

        await DB("shortcut").where("id", id).update(updates);
        broadcastShortcutsChanged();
        return { success: true };
      } catch (err) {
        log.error("shortcut:update error:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle("shortcut:delete", async (_event, id: number): Promise<boolean> => {
    try {
      await DB("shortcut").where("id", id).delete();
      broadcastShortcutsChanged();
      return true;
    } catch (err) {
      log.error("shortcut:delete error:", err);
      return false;
    }
  });

  ipcMain.handle("shortcut:reorder", async (_event, ids: number[]): Promise<boolean> => {
    try {
      if (!Array.isArray(ids)) return false;
      for (let i = 0; i < ids.length; i++) {
        await DB("shortcut").where("id", ids[i]).update({ sort_order: i });
      }
      broadcastShortcutsChanged();
      return true;
    } catch (err) {
      log.error("shortcut:reorder error:", err);
      return false;
    }
  });

  ipcMain.handle(
    "shortcut:open",
    async (_event, id: number): Promise<{ success: boolean; error?: string }> => {
      try {
        const row = await DB("shortcut").where("id", id).first();
        if (!row) return { success: false, error: "快捷方式不存在" };

        if (row.kind === "url") {
          await shell.openExternal(row.target);
          return { success: true };
        }

        const failure = await shell.openPath(row.target);
        if (failure) return { success: false, error: failure };
        return { success: true };
      } catch (err) {
        log.error("shortcut:open error:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(
    "shortcut:pick",
    async (_event, kind: string): Promise<ShortcutPickResult | null> => {
      try {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) {
          log.error("shortcut:pick 调用时主窗口不存在，无法打开选择框");
          return null;
        }

        if (kind === "folder") {
          const res = await dialog.showOpenDialog(win, {
            title: "选择文件夹",
            properties: ["openDirectory"],
          });
          const picked = res.filePaths[0];
          return picked ? { kind: "folder", target: picked, title: deriveTitle("folder", picked) } : null;
        }

        const res = await dialog.showOpenDialog(win, {
          title: "选择程序",
          properties: ["openFile"],
          filters: [
            { name: "程序", extensions: APP_EXTENSIONS.map((ext) => ext.slice(1)) },
            { name: "所有文件", extensions: ["*"] },
          ],
        });
        const picked = res.filePaths[0];
        return picked ? { kind: "app", target: picked, title: deriveTitle("app", picked) } : null;
      } catch (err) {
        log.error("shortcut:pick error:", err);
        return null;
      }
    }
  );

  ipcMain.handle("shell-menu:status", async () => {
    return await getContextMenuStatus();
  });

  ipcMain.handle("shell-menu:repair", async () => {
    try {
      return await repairContextMenu();
    } catch (err) {
      log.error("shell-menu:repair error:", err);
      return { success: false, repaired: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    "shell-menu:set",
    async (_event, enabled: boolean): Promise<{ success: boolean; error?: string }> => {
      return await setContextMenuEnabled(!!enabled);
    }
  );

  ipcMain.handle("shortcut:clear", async (): Promise<boolean> => {
    try {
      await DB("shortcut").del();
      broadcastShortcutsChanged();
      return true;
    } catch (err) {
      log.error("shortcut:clear error:", err);
      return false;
    }
  });

  ipcMain.handle("shortcut:normalize-target", async (_event, target: string) => {
    const trimmed = (target ?? "").trim();
    if (!trimmed) return null;
    const kind = inferShortcutKind(trimmed);
    const normalized = normalizeInput({ kind, target: trimmed });
    if ("error" in normalized) return { kind, target: trimmed, error: normalized.error };
    return normalized;
  });

  log.info(`快捷方式 IPC 处理器已注册（${app.isPackaged ? "打包版" : "开发版"}）`);
}
