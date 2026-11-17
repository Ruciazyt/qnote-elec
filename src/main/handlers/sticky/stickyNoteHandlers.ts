import { BrowserWindow, ipcMain, screen, Menu } from "electron";
import { log } from "../../core/system/log";
import { stickyNoteManager } from "../../core/window/sticky/stickyNote";
import type {
  StickyBounds,
  StickyHoldPayload,
  StickyNotePatch,
} from "../../../shared/sticky/stickyNote";

export function registerStickyNoteHandlers(): void {
  ipcMain.on("sticky:hold-begin", (event, payload: StickyHoldPayload) => {
    try {
      stickyNoteManager.beginHold(payload);
    } catch (err) {
      log.error("[sticky] hold-begin 处理失败:", err);
    }
  });

  ipcMain.on("sticky:hold-end", () => {
    stickyNoteManager.endDrag();
  });

  ipcMain.handle("sticky:get-init", (event) => {
    try {
      return stickyNoteManager.getInit(event.sender.id);
    } catch (err) {
      log.error("[sticky] get-init 处理失败:", err);
      return null;
    }
  });

  ipcMain.handle("sticky:update", (event, patch: StickyNotePatch) => {
    try {
      const resolved: StickyNotePatch = { ...patch };
      if (!resolved.id) {
        resolved.id = stickyNoteManager.getNoteIdByWebContents(event.sender.id);
      }
      return stickyNoteManager.update(resolved);
    } catch (err) {
      log.error("[sticky] update 处理失败:", err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("sticky:close", (event, id?: string) => {
    try {
      const targetId = id || stickyNoteManager.getNoteIdByWebContents(event.sender.id);
      return stickyNoteManager.close(targetId);
    } catch (err) {
      log.error("[sticky] close 处理失败:", err);
      return { ok: false };
    }
  });

  ipcMain.handle("sticky:set-bounds", (event, bounds: StickyBounds) => {
    try {
      const resolved: StickyBounds = { ...bounds };
      if (!resolved.id) {
        resolved.id = stickyNoteManager.getNoteIdByWebContents(event.sender.id);
      }
      return stickyNoteManager.setBounds(resolved);
    } catch (err) {
      log.error("[sticky] set-bounds 处理失败:", err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("sticky:move-begin", (event, id?: string, anchor?: { x: number; y: number }) => {
    try {
      const targetId = id || stickyNoteManager.getNoteIdByWebContents(event.sender.id);
      if (!targetId) return { ok: false };
      return stickyNoteManager.beginMove(targetId, anchor);
    } catch (err) {
      log.error("[sticky] move-begin 处理失败:", err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("sticky:move-end", () => {
    try {
      stickyNoteManager.endDrag();
    } catch (err) {
      log.error("[sticky] move-end 处理失败:", err);
    }
    return { ok: true };
  });

  ipcMain.handle("sticky:list", () => {
    try {
      return stickyNoteManager.list();
    } catch (err) {
      log.error("[sticky] list 处理失败:", err);
      return [];
    }
  });

  ipcMain.handle("sticky:create", (_event, payload: StickyHoldPayload) => {
    try {
      if (!payload || (payload.type !== "text" && payload.type !== "image")) {
        return { ok: false, error: "内容类型不正确" };
      }
      if (typeof payload.content !== "string" || payload.content.length === 0) {
        return { ok: false, error: "内容为空" };
      }
      const cursor = screen.getCursorScreenPoint();
      const id = stickyNoteManager.createFromPayload(payload, cursor);
      return { ok: true, id };
    } catch (err) {
      log.error("[sticky] create 处理失败:", err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("sticky:show-menu", (event) => {
    try {
      const noteId = stickyNoteManager.getNoteIdByWebContents(event.sender.id);
      const win = BrowserWindow.fromWebContents(event.sender);
      const note = stickyNoteManager.getInit(event.sender.id);
      if (!noteId || !win || !note) return false;

      const menu = Menu.buildFromTemplate([
        ...(note.type === "text"
          ? [
              {
                label: "编辑内容",
                click: () => {
                  if (!win.isDestroyed()) win.webContents.send("sticky:edit");
                },
              },
            ]
          : []),
        {
          label: note.alwaysOnTop ? "取消屏幕级置顶" : "屏幕级置顶",
          click: () => {
            stickyNoteManager.update({ id: noteId, alwaysOnTop: !note.alwaysOnTop });
          },
        },
        ...(note.type === "text"
          ? [
              {
                label: "自适应大小",
                type: "checkbox" as const,
                checked: note.autoSize,
                click: (item: Electron.MenuItem) => {
                  stickyNoteManager.update({ id: noteId, autoSize: item.checked });
                  if (!win.isDestroyed()) win.webContents.send("sticky:autosize", item.checked);
                },
              },
            ]
          : []),
        { type: "separator" },
        {
          label: "关闭便签",
          click: () => {
            stickyNoteManager.close(noteId);
          },
        },
      ]);
      menu.popup({ window: win });
      return true;
    } catch (err) {
      log.error("[sticky] show-menu 处理失败:", err);
      return false;
    }
  });
}
