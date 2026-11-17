import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import * as path from "node:path";
import type { Knex } from "knex";
import { log } from "../../core/system/log";
import { AppManager } from "../../core/apps/appManager";
import {
  APP_PREVIEW_SCHEME,
  loadAppPreview,
  setAppPreviewBounds,
  setAppPreviewVisible,
} from "../../core/window/apps/appPreview";
import { getMainWindow } from "../../core/window/index";
import type {
  AppImportResult,
  AppLogLine,
  AppManifest,
  AppProject,
  AppRuntimeState,
  StartConfirmation,
} from "../../../shared/apps/appTypes";


let manager: AppManager | null = null;

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

function encodeRelativePath(relative: string): string {
  return relative
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

export function registerAppHandlers(DB: Knex): AppManager {
  const appManager = new AppManager(DB);
  manager = appManager;

  appManager.setEventSink({
    onProjectsChanged(projects: AppProject[]) {
      broadcast("app:projects-changed", projects);
    },
    onRuntimeChanged(state: AppRuntimeState) {
      broadcast("app:runtime-changed", state);
    },
    onLog(line: AppLogLine) {
      broadcast("app:log", line);
    },
  });


  ipcMain.handle("app:list-projects", async () => {
    return await appManager.listProjects();
  });

  ipcMain.handle("app:import-project", async (_event, dirPath: string) => {
    return await appManager.importProject(String(dirPath ?? ""));
  });

  ipcMain.handle("app:remove-project", async (_event, id: number) => {
    return await appManager.removeProject(Number(id));
  });

  ipcMain.handle("app:refresh-projects", async () => {
    return await appManager.refreshProjects();
  });

  ipcMain.handle(
    "app:write-manifest",
    async (_event, projectPath: string, payload: Partial<AppManifest>) => {
      return await appManager.writeManifest(String(projectPath ?? ""), payload ?? {});
    }
  );

  ipcMain.handle("app:open-folder", async (_event, target: string) => {
    try {
      const dir = path.resolve(String(target ?? ""));
      const projects = await appManager.listProjects();
      const known = projects.some((p) => path.resolve(p.path) === dir);
      if (!known) {
        log.warn("[app] 拒绝打开未登记的目录:", dir);
        return { ok: false, error: "只能打开已登记的项目目录" };
      }
      const failure = await shell.openPath(dir); // NOSONAR
      if (failure) return { ok: false, error: failure };
      return { ok: true };
    } catch (err) {
      log.error("app:open-folder error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("app:pick-project-dir", async () => {
    try {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) {
        log.error("app:pick-project-dir 调用时主窗口不存在");
        return null;
      }
      const res = await dialog.showOpenDialog(win, {
        title: "选择项目文件夹",
        properties: ["openDirectory"],
      });
      return res.filePaths[0] ?? null;
    } catch (err) {
      log.error("app:pick-project-dir error:", err);
      return null;
    }
  });


  ipcMain.handle(
    "app:import-from-market",
    async (
      _event,
      dirPath: string,
      payload: Partial<AppManifest>
    ): Promise<AppImportResult> => {
      return await appManager.importFromMarket(String(dirPath ?? ""), payload ?? {});
    }
  );

  ipcMain.handle(
    "app:start",
    async (
      _event,
      projectId: number,
      confirmedManifestHash?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      needsConfirmation?: StartConfirmation;
    }> => {
      return await appManager.startProject(
        Number(projectId),
        confirmedManifestHash ? String(confirmedManifestHash) : undefined
      );
    }
  );

  ipcMain.handle("app:stop", async (_event, projectId: number) => {
    return await appManager.stopProject(Number(projectId));
  });

  ipcMain.handle("app:runtime-states", async () => {
    return appManager.getRuntimeStates();
  });

  ipcMain.handle("app:logs", async (_event, projectId: number) => {
    return appManager.getLogs(Number(projectId));
  });

  ipcMain.handle("app:clear-logs", async (_event, projectId: number) => {
    appManager.clearLogs(Number(projectId));
    return true;
  });


  ipcMain.handle("app:preview-load", async (_event, projectId: number) => {
    try {
      const id = Number(projectId);
      const project = await appManager.getProject(id);
      if (!project) return { ok: false, error: "项目不存在" };
      if (!project.preview) return { ok: false, error: "该项目没有配置预览页面" };

      let url: string;
      let display: string;
      if (/^https?:\/\//i.test(project.preview)) {
        url = project.preview;
        display = project.preview;
      } else {
        url = `${APP_PREVIEW_SCHEME}://p${id}/${encodeRelativePath(project.preview)}`;
        display = path.join(project.path, project.preview.replace(/\//g, path.sep));
      }

      const ok = loadAppPreview(url, id);
      if (!ok) return { ok: false, error: "预览视图不可用" };
      return { ok: true, url, display };
    } catch (err) {
      log.error("app:preview-load error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("app:preview-visible", async (_event, visible: boolean) => {
    setAppPreviewVisible(!!visible);
  });

  ipcMain.handle(
    "app:preview-bounds",
    async (
      _event,
      rect: { x: number; y: number; width: number; height: number }
    ) => {
      if (!rect) return;
      setAppPreviewBounds({
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0,
      });
    }
  );

  log.info("应用管理 IPC 处理器已注册");
  return appManager;
}

export function teardownAppHandlers(): void {
  manager?.disposeAllSync();
}

export function resolveAppProjectDir(projectId: number): string | null {
  return manager?.getProjectDirSync(projectId) ?? null;
}
