import { BrowserWindow, ipcMain, screen, Menu } from "electron";
import { log } from "../utils/log";
import { stickyNoteManager } from "../core/window/stickyNote";
import type {
  StickyBounds,
  StickyHoldPayload,
  StickyNotePatch,
} from "../../shared/stickyNote";

/**
 * 屏幕便签的 IPC
 *
 * 通道划分：
 *   - `sticky:hold-begin` / `sticky:hold-end` 用 send 而不是 invoke：
 *     长按过程中要连续发，用 invoke 会攒出一堆等待中的 Promise。
 *   - 其余用 handle：都需要返回值（便签初始数据、保存结果）。
 */
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

  /**
   * 开始移动一张便签
   *
   * 渲染层判定"用户是在拖动"之后发起，之后由主进程轮询光标来移动窗口 ——
   * 渲染层给的坐标是 CSS 像素，窗口坐标是 DIP，缩放不是 100% 时对不上。
   */
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

  /** 结束移动（松手） */
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

  /**
   * 直接创建一张便签（不经过拖拽）
   *
   * 拖拽是主路径，但它是**只能靠"发现"才会用的功能** ——
   * 菜单里再给一个显式入口，用户不必先猜"原来可以往外拖"。
   * 便签落在当前光标处。
   */
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

  /**
   * 便签的原生右键菜单
   *
   * 便签画面上不放任何常驻控件（只有一张纸和一段字），但关闭、置顶、
   * 编辑这些操作还得留着，于是走右键菜单：原生菜单弹出即用、关掉就没，
   * 不会在便签上留下任何痕迹。
   */
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
                /**
                 * 尺寸模式：随内容自适应 / 用用户手动拖出来的尺寸
                 *
                 * 默认是自适应的 —— 纸正好包住正文，不多不少。
                 * 用户拖过缩放手柄后转成手动，这时勾选这一项可以把纸
                 * 重新收回"正好包住内容"的状态。
                 */
                label: "自适应大小",
                type: "checkbox" as const,
                checked: note.autoSize,
                click: (item: Electron.MenuItem) => {
                  stickyNoteManager.update({ id: noteId, autoSize: item.checked });
                  // 让渲染层重新量一次正文，纸才会真的缩回去
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
