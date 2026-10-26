import { BrowserWindow, ipcMain, screen, Menu } from "electron";
import { log } from "../utils/log";
import { stickyNoteManager } from "../core/window/stickyNote";
import type {
  StickyBounds,
  StickyDragPayload,
  StickyNotePatch,
} from "../../shared/stickyNote";

/**
 * 屏幕便签的 IPC
 *
 * 通道划分：
 *   - `sticky:drag-begin` / `sticky:drag-end` 用 send 而不是 invoke：
 *     拖拽过程中每帧都可能触发，用 invoke 会攒出一堆等待中的 Promise。
 *   - 其余用 handle：都需要返回值（便签初始数据、保存结果）。
 */
export function registerStickyNoteHandlers(): void {
  ipcMain.on("sticky:drag-begin", (event, payload: StickyDragPayload) => {
    try {
      const source = BrowserWindow.fromWebContents(event.sender);
      stickyNoteManager.beginDrag(source, payload);
    } catch (err) {
      log.error("[sticky] drag-begin 处理失败:", err);
    }
  });

  ipcMain.on("sticky:drag-end", () => {
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

  ipcMain.handle("sticky:list", () => {
    try {
      return stickyNoteManager.list();
    } catch (err) {
      log.error("[sticky] list 处理失败:", err);
      return [];
    }
  });

  /**
   * 直接创建一张便签（不经过拖拽）
   *
   * 拖拽是主路径，但它是**只能靠"发现"才会用的功能** ——
   * 菜单里再给一个显式入口，用户不必先猜"原来可以往外拖"。
   * 便签落在当前光标处。
   */
  ipcMain.handle("sticky:create", (_event, payload: StickyDragPayload) => {
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

  /**
   * 便签的原生右键菜单
   *
   * 图片便签为了"只剩内容"，画面上不放任何常驻控件 ——
   * 但取消置顶、关闭这些操作还得留着，于是走右键菜单：
   * 原生菜单弹出即用、关掉就没，不会在便签上留下任何痕迹。
   */
  ipcMain.handle("sticky:show-menu", (event) => {
    try {
      const noteId = stickyNoteManager.getNoteIdByWebContents(event.sender.id);
      const win = BrowserWindow.fromWebContents(event.sender);
      const note = stickyNoteManager.getInit(event.sender.id);
      if (!noteId || !win || !note) return false;

      const menu = Menu.buildFromTemplate([
        {
          label: note.alwaysOnTop ? "取消屏幕级置顶" : "屏幕级置顶",
          click: () => {
            stickyNoteManager.update({ id: noteId, alwaysOnTop: !note.alwaysOnTop });
          },
        },
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
