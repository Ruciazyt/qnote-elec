import { ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../utils/log";
import { configManager } from "../utils/config";
import { IslandWindow } from "../core/window/island";
import { getAiActivity, onAiActivityChange } from "../core/aiActivity";
import { NoteStore } from "../core/noteStore";
import { getMainWindow, showMainWindow } from "../core/window/mainWindow";
import type { FileWriter } from "../core/fileWriter";
import { ISLAND_PAGES, type IslandPage, type IslandRecentNote } from "../../shared/island";

/**
 * 页签 → 主窗口路由
 *
 * 岛上的四个页签对应主窗口的四个去处。点在岛上的条目时，
 * 主窗口要跳到能处理这个条目的地方，而不是仅仅显示出来。
 */
const PAGE_ROUTES: Record<IslandPage, string> = {
  todo: "/todos",
  clipboard: "/",
  notes: "/notes",
  ai: "/",
};

/** 最近笔记最多返回多少条 */
const RECENT_NOTES_LIMIT = 20;

function isIslandPage(value: unknown): value is IslandPage {
  return typeof value === "string" && (ISLAND_PAGES as readonly string[]).includes(value);
}

/** 把目录树摊平成文件列表 */
function flattenFiles(nodes: any[], out: any[] = []): any[] {
  for (const node of nodes) {
    if (!node) continue;
    if (node.kind === "file") {
      out.push(node);
    } else if (Array.isArray(node.children)) {
      flattenFiles(node.children, out);
    }
  }
  return out;
}

/** 主窗口当前是不是藏在后台（最小化或收进托盘） */
function isMainWindowHidden(): boolean {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return true;
  return !win.isVisible() || win.isMinimized();
}

export function registerIslandHandlers(fileWriter: FileWriter): void {
  const island = IslandWindow.getInstance();

  // ── 配置 ────────────────────────────────────────────────────────────────

  ipcMain.handle("island:get-settings", async () => {
    try {
      return await configManager.getIslandSettings();
    } catch (err) {
      log.error("[island] 读取配置失败", err);
      return {
        enabled: true,
        expandTrigger: "click",
        hoverDelayMs: 300,
        attachMode: "attached",
        position: null,
        displayId: null,
      };
    }
  });

  ipcMain.handle(
    "island:set-settings",
    async (_event: IpcMainInvokeEvent, patch: Record<string, unknown>) => {
      try {
        const next = await configManager.setIslandSettings(patch ?? {});
        // 启用状态要同步进窗口对象：主窗口的 minimize 事件是同步触发的，
        // 靠它决定要不要把岛叫上来。
        island.setEnabled(next.enabled);
        // 位置、贴顶模式和所在显示器直接作用在窗口上，落库之后马上同步
        island.applyAttachMode(next.attachMode, next.position, next.displayId);
        if (!next.enabled) {
          island.hide();
        } else if (isMainWindowHidden()) {
          // 重新打开开关时主窗口正藏在后面，岛立刻顶上来的观感才对
          island.show();
        }
        return next;
      } catch (err) {
        log.error("[island] 保存配置失败", err);
        throw err;
      }
    }
  );

  // ── 状态与展开收起 ──────────────────────────────────────────────────────

  ipcMain.handle("island:get-state", () => island.getSnapshot());

  ipcMain.on("island:expand", () => island.expand());
  ipcMain.on("island:collapse", () => island.collapse());
  ipcMain.on("island:toggle", () => island.toggle());

  ipcMain.on("island:set-page", (_event, page: unknown) => {
    if (!isIslandPage(page)) return;
    island.setPage(page);
  });

  ipcMain.on("island:set-collapsed-width", (_event, width: unknown) => {
    if (typeof width !== "number") return;
    island.setCollapsedWidth(width);
  });

  ipcMain.on("island:reset-position", () => {
    island.resetPosition();
  });

  // ── 拖动 ────────────────────────────────────────────────────────────────

  ipcMain.on("island:drag-start", (_event, payload: { screenX?: number; screenY?: number }) => {
    const x = Number(payload?.screenX);
    const y = Number(payload?.screenY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    island.beginDrag(x, y);
  });

  ipcMain.on("island:drag-move", (_event, payload: { screenX?: number; screenY?: number }) => {
    const x = Number(payload?.screenX);
    const y = Number(payload?.screenY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    island.dragTo(x, y);
  });

  ipcMain.on("island:drag-end", async () => {
    const result = island.endDrag();
    // 拖放结果要落库 —— 否则下次启动岛又回到贴顶居中，
    // 用户会以为拖了个寂寞。
    try {
      await configManager.setIslandSettings({
        attachMode: result.attachMode,
        position: result.position,
        displayId: result.displayId,
      });
    } catch (err) {
      log.warn("[island] 拖放位置保存失败", err);
    }
  });

  /**
   * 窗口要不要接收鼠标事件
   *
   * 窗口比卡片大一圈（给阴影留地方），那圈是透明的 ——
   * 渲染层判断鼠标有没有落在卡片上，落在外面就把窗口放成穿透，
   * 别让那圈把底下应用的点击吃掉。
   */
  ipcMain.on("island:set-interactive", (_event, interactive: unknown) => {
    island.setInteractive(Boolean(interactive));
  });

  // ── 回到主窗口 ──────────────────────────────────────────────────────────

  /**
   * 从岛跳回主窗口
   *
   * relPath 非空表示还要打开某一篇具体笔记 —— 主窗口的笔记页
   * 通过 islandBridge 领取这个请求（keep-alive 页面可能还没挂载）。
   */
  ipcMain.handle(
    "island:open-main",
    (_event: IpcMainInvokeEvent, payload?: { page?: unknown; relPath?: unknown }) => {
      const page = isIslandPage(payload?.page) ? payload.page : "todo";
      const relPath = typeof payload?.relPath === "string" ? payload.relPath : null;

      showMainWindow();
      island.hide();

      const win = getMainWindow();
      if (!win || win.isDestroyed()) return { ok: false };
      if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => {
          win.webContents.send("island:navigate", { route: PAGE_ROUTES[page], relPath });
        });
      } else {
        win.webContents.send("island:navigate", { route: PAGE_ROUTES[page], relPath });
      }
      return { ok: true };
    }
  );

  // ── 最近笔记 ────────────────────────────────────────────────────────────

  ipcMain.handle("island:get-recent-notes", async (): Promise<IslandRecentNote[]> => {
    try {
      const root = fileWriter.getRootPath();
      if (!root) return [];
      const noteStore = new NoteStore();
      const files = flattenFiles(noteStore.tree(root));
      files.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
      return files.slice(0, RECENT_NOTES_LIMIT).map((file) => ({
        relPath: file.relPath,
        name: file.name,
        mtime: file.mtime ?? 0,
        type: file.type,
      }));
    } catch (err) {
      log.error("[island] 读取最近笔记失败", err);
      return [];
    }
  });

  // ── AI 任务状态 ─────────────────────────────────────────────────────────

  ipcMain.handle("island:get-ai-activity", () => getAiActivity());

  /**
   * AI 任务状态变化时推给岛
   *
   * 只推给岛那一个窗口 —— 主窗口自己知道 AI 在跑什么，不需要这份快照。
   * 订阅跟进程同寿：应用退出时整个进程都没了，不存在泄漏。
   */
  onAiActivityChange((activity) => {
    island.send("island:ai-activity", activity);
  });

  log.info("[island] IPC 处理器已注册");
}

/**
 * 关闭灵动岛窗口
 *
 * 应用退出时调用 —— 否则这个置顶窗口会吊住进程。
 */
export function disposeIsland(): void {
  IslandWindow.getInstance().destroy();
}
