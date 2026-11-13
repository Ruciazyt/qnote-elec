import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import * as path from "node:path";
import type { Knex } from "knex";
import { log } from "../utils/log";
import { AppManager } from "../core/appManager";
import {
  APP_PREVIEW_SCHEME,
  loadAppPreview,
  setAppPreviewBounds,
  setAppPreviewVisible,
} from "../core/window/appPreview";
import { getMainWindow } from "../core/window";
import type {
  AppImportResult,
  AppLogLine,
  AppManifest,
  AppProject,
  AppRuntimeState,
  StartConfirmation,
} from "../../shared/appTypes";

/**
 * 应用管理 —— IPC 层
 *
 * 通道前缀统一用 `app:`，事件（主进程 → 渲染层）也在这套前缀下。
 */

let manager: AppManager | null = null;

/** 向所有窗口广播 —— 多窗口时只发给调用方，另一个窗口会看不到变化 */
function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

/** 把相对路径编码成 scheme 下的 URL 片段 */
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

  // ------------------------------------------------------------------
  // 项目
  // ------------------------------------------------------------------

  ipcMain.handle("app:list-projects", async () => {
    return await appManager.listProjects();
  });

  /**
   * 导入一个项目文件夹
   *
   * 合规条件：目录下有能解析通过的 qnote.json。
   * 不合规时返回失败原因分类，界面据此给出「生成清单」或「修正清单」。
   */
  ipcMain.handle("app:import-project", async (_event, dirPath: string) => {
    return await appManager.importProject(String(dirPath ?? ""));
  });

  /** 移除项目（同时停掉它的进程） */
  ipcMain.handle("app:remove-project", async (_event, id: number) => {
    return await appManager.removeProject(Number(id));
  });

  /** 重新读一遍所有已导入项目的清单 —— 用户改了 qnote.json 后刷新即生效 */
  ipcMain.handle("app:refresh-projects", async () => {
    return await appManager.refreshProjects();
  });

  /** 写入项目清单 qnote.json —— 创建与编辑同一条路径 */
  ipcMain.handle(
    "app:write-manifest",
    async (_event, projectPath: string, payload: Partial<AppManifest>) => {
      return await appManager.writeManifest(String(projectPath ?? ""), payload ?? {});
    }
  );

  /** 在系统文件管理器里打开项目目录 */
  ipcMain.handle("app:open-folder", async (_event, target: string) => {
    try {
      const dir = path.resolve(String(target ?? ""));
      // 只允许打开**已登记的项目目录**。
      //
      // shell.openPath 碰到 .exe / .bat 会把它直接跑起来 ——
      // 渲染层传什么就开什么，等于给了一条任意代码执行的通路。
      // 这里把范围收死在用户自己导入的项目目录里。
      // （Sonar 的污点分析认不出「已登记目录」这种校验，所以这里显式 NOSONAR）
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

  /** 系统目录选择器 —— 窗口句柄必须在调用时现取 */
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

  // ------------------------------------------------------------------
  // 进程运行
  // ------------------------------------------------------------------

  /**
   * 从应用市场导入一个项目
   *
   * 与「导入文件夹」分开 —— 它会**拒绝覆盖**目标目录里已有的 qnote.json，
   * 并且把项目标记为市场来源（首次运行前要用户确认）。
   */
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

  /**
   * 启动项目的常驻进程
   *
   * 来自市场的项目第一次启动前要用户确认 —— 主进程发现需要确认时
   * 返回 needsConfirmation（带完整命令行与风险分析），由渲染层弹确认框，
   * 用户点了再带着清单指纹调回来。
   */
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

  // ------------------------------------------------------------------
  // 预览
  // ------------------------------------------------------------------

  /**
   * 载入预览
   *
   * 清单里的 preview 有两种写法：
   * - `index.html` / `dist/index.html` —— 项目内文件，走 qnote-app:// 协议
   * - `http://localhost:3000` —— 指向运行中的服务，直接加载
   *
   * 返回两个地址：
   * - url：真正加载的那个（本地文件是 qnote-app://p<id>/...）
   * - display：给人看的那个（本地文件时换成绝对路径，端口信息照常可见）
   */
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
        // 本地文件的真实位置比 qnote-app:// 协议地址有用得多
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

/**
 * 退出时收掉所有常驻进程
 *
 * 用同步版本：退出流程没有时间等异步往返，等价于"关掉应用 = 进程真的停了"。
 */
export function teardownAppHandlers(): void {
  manager?.disposeAllSync();
}

/** 供预览协议解析项目根目录 */
export function resolveAppProjectDir(projectId: number): string | null {
  return manager?.getProjectDirSync(projectId) ?? null;
}
