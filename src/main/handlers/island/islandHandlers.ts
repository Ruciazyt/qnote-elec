import { ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../../core/system/log";
import { configManager } from "../../core/system/config";
import { IslandWindow } from "../../core/window/island/island";
import { getAiActivity, onAiActivityChange } from "../../core/ai/aiActivity";
import { NoteStore } from "../../core/notes/noteStore";
import { getMainWindow, showMainWindow } from "../../core/window/mainWindow";
import type { FileWriter } from "../../core/notes/fileWriter";
import { ISLAND_PAGES, type IslandPage, type IslandRecentNote } from "../../../shared/island/island";

const PAGE_ROUTES: Record<IslandPage, string> = {
  todo: "/todos",
  clipboard: "/",
  notes: "/notes",
  ai: "/",
};

const RECENT_NOTES_LIMIT = 20;

function isIslandPage(value: unknown): value is IslandPage {
  return typeof value === "string" && (ISLAND_PAGES as readonly string[]).includes(value);
}

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

function isMainWindowHidden(): boolean {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return true;
  return !win.isVisible() || win.isMinimized();
}

export function registerIslandHandlers(fileWriter: FileWriter): void {
  const island = IslandWindow.getInstance();


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
        dockEdge: "top",
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
        island.setEnabled(next.enabled);
        island.applyDock(next.attachMode, next.dockEdge, next.position, next.displayId);
        if (!next.enabled) {
          island.hide();
        } else if (isMainWindowHidden()) {
          island.show();
        }
        return next;
      } catch (err) {
        log.error("[island] 保存配置失败", err);
        throw err;
      }
    }
  );


  ipcMain.handle("island:get-state", () => island.getSnapshot());

  ipcMain.on("island:expand", () => island.expand());
  ipcMain.on("island:collapse", () => island.collapse());
  ipcMain.on("island:toggle", () => island.toggle());

  ipcMain.on("island:set-page", (_event, page: unknown) => {
    if (!isIslandPage(page)) return;
    island.setPage(page);
  });

  ipcMain.on("island:reset-position", () => {
    island.resetPosition();
  });


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
    try {
      await configManager.setIslandSettings({
        attachMode: result.attachMode,
        dockEdge: result.dockEdge,
        position: result.position,
        displayId: result.displayId,
      });
    } catch (err) {
      log.warn("[island] 拖放位置保存失败", err);
    }
  });

  ipcMain.on("island:set-interactive", (_event, interactive: unknown) => {
    island.setInteractive(Boolean(interactive));
  });


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


  ipcMain.handle("island:get-ai-activity", () => getAiActivity());

  onAiActivityChange((activity) => {
    island.send("island:ai-activity", activity);
  });

  log.info("[island] IPC 处理器已注册");
}

export function disposeIsland(): void {
  IslandWindow.getInstance().destroy();
}
