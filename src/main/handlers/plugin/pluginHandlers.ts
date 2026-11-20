import {
  parsePluginPreview,
  previewPortUrl,
} from "../../../shared/plugin/pluginPreview";
import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import { appVersion } from "../../core/system/appVersion";
import * as path from "node:path";
import type { Knex } from "knex";
import { log } from "../../core/system/log";
import { PluginManager } from "../../core/plugin/pluginManager";
import { migrateLegacyProjects } from "../../core/plugin/legacyMigration";
import { packProjectBundle } from "../../core/plugin/bundle";
import {
  PLUGIN_PREVIEW_SCHEME,
  loadPluginPreview,
  setPluginPreviewBounds,
  setPluginPreviewVisible,
} from "../../core/window/plugin/pluginPreview";
import { getMainWindow } from "../../core/window/index";
import type {
  MarketImportPayload,
  PluginImportResult,
  PluginLogLine,
  PluginManifestDraft,
  PluginRecord,
  PluginRuntimeState,
  StartConfirmation,
} from "../../../shared/plugin/pluginTypes";

let manager: PluginManager | null = null;

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

export function registerPluginHandlers(DB: Knex): PluginManager {
  const pluginManager = new PluginManager(DB);
  pluginManager.setHostVersion(appVersion());
  manager = pluginManager;

  pluginManager.setEventSink({
    onPluginsChanged(plugins: PluginRecord[]) {
      broadcast("plugin:plugins-changed", plugins);
    },
    onRuntimeChanged(state: PluginRuntimeState) {
      broadcast("plugin:runtime-changed", state);
    },
    onLog(line: PluginLogLine) {
      broadcast("plugin:log", line);
    },
    onNotify(pluginId: string, level: string, message: string) {
      broadcast("plugin:notify", { pluginId, level, message });
    },
  });

  void migrateLegacyProjects(DB, pluginManager.getHostVersion())
    .then((result) => {
      if (result.migrated > 0) {
        void pluginManager.refreshPlugins();
      }
    })
    .catch((err) => log.error("[plugin] 旧应用迁移失败:", err));

  ipcMain.handle("plugin:list", async () => {
    return await pluginManager.listPlugins();
  });

  ipcMain.handle("plugin:import", async (_event, dirPath: string) => {
    return await pluginManager.importPlugin(String(dirPath ?? ""));
  });

  ipcMain.handle("plugin:remove", async (_event, id: string) => {
    return await pluginManager.removePlugin(String(id ?? ""));
  });

  ipcMain.handle("plugin:set-enabled", async (_event, id: string, enabled: boolean) => {
    return await pluginManager.setEnabled(String(id ?? ""), !!enabled);
  });

  ipcMain.handle("plugin:refresh", async () => {
    return await pluginManager.refreshPlugins();
  });

  ipcMain.handle(
    "plugin:write-manifest",
    async (_event, pluginPath: string, payload: PluginManifestDraft) => {
      return await pluginManager.writeManifest(String(pluginPath ?? ""), payload ?? {});
    }
  );

  ipcMain.handle("plugin:open-folder", async (_event, target: string) => {
    try {
      const dir = path.resolve(String(target ?? ""));
      const plugins = await pluginManager.listPlugins();
      const known = plugins.some((p) => path.resolve(p.path) === dir);
      if (!known) {
        log.warn("[plugin] 拒绝打开未登记的目录:", dir);
        return { ok: false, error: "只能打开已登记的插件目录" };
      }
      const failure = await shell.openPath(dir); // NOSONAR
      if (failure) return { ok: false, error: failure };
      return { ok: true };
    } catch (err) {
      log.error("plugin:open-folder error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("plugin:pick-dir", async () => {
    try {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) {
        log.error("plugin:pick-dir 调用时主窗口不存在");
        return null;
      }
      const res = await dialog.showOpenDialog(win, {
        title: "选择插件文件夹",
        properties: ["openDirectory"],
      });
      return res.filePaths[0] ?? null;
    } catch (err) {
      log.error("plugin:pick-dir error:", err);
      return null;
    }
  });

  ipcMain.handle(
    "plugin:import-from-market",
    async (
      _event,
      dirPath: string,
      payload: MarketImportPayload
    ): Promise<PluginImportResult> => {
      return await pluginManager.importFromMarket(String(dirPath ?? ""), payload ?? {});
    }
  );

  ipcMain.handle(
    "plugin:build-bundle",
    async (
      _event,
      pluginId: string
    ): Promise<{
      ok: boolean;
      error?: string;
      bundle?: string;
      fileCount?: number;
      bytes?: number;
      skipped?: string[];
      tooLarge?: boolean;
    }> => {
      const plugin = await pluginManager.getPlugin(String(pluginId ?? ""));
      if (!plugin) {
        return { ok: false, error: "插件不存在" };
      }
      try {
        const packed = packProjectBundle(plugin.path);
        return {
          ok: true,
          bundle: packed.bundle,
          fileCount: packed.fileCount,
          bytes: packed.bytes,
          skipped: packed.skipped,
          tooLarge: packed.tooLarge,
        };
      } catch (err) {
        log.error("plugin:build-bundle error:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle(
    "plugin:start",
    async (
      _event,
      pluginId: string,
      confirmedManifestHash?: string
    ): Promise<{
      ok: boolean;
      error?: string;
      needsConfirmation?: StartConfirmation;
    }> => {
      return await pluginManager.startPlugin(
        String(pluginId ?? ""),
        confirmedManifestHash ? String(confirmedManifestHash) : undefined
      );
    }
  );

  ipcMain.handle("plugin:stop", async (_event, pluginId: string) => {
    return await pluginManager.stopPlugin(String(pluginId ?? ""));
  });

  ipcMain.handle("plugin:runtime-states", async () => {
    return pluginManager.getRuntimeStates();
  });

  ipcMain.handle("plugin:logs", async (_event, pluginId: string) => {
    return pluginManager.getLogs(String(pluginId ?? ""));
  });

  ipcMain.handle("plugin:clear-logs", async (_event, pluginId: string) => {
    pluginManager.clearLogs(String(pluginId ?? ""));
    return true;
  });

  ipcMain.handle("plugin:preview-load", async (_event, localId: number) => {
    try {
      const id = Number(localId);
      const dir = pluginManager.getPluginDirByLocalId(id);
      if (!dir) return { ok: false, error: "插件不存在" };
      const plugin = await pluginManager.getPluginByLocalId(id);
      if (!plugin) return { ok: false, error: "插件不存在" };

      const spec = parsePluginPreview(plugin.runtime?.preview);
      if (!spec) return { ok: false, error: "这个插件没有配置预览页面" };

      let url: string;
      let display: string;
      if (spec.type === "port") {
        url = previewPortUrl(spec.port);
        display = url;
      } else if (spec.type === "url") {
        url = spec.url;
        display = spec.url;
      } else {
        url = `${PLUGIN_PREVIEW_SCHEME}://p${id}/${encodeRelativePath(spec.path)}`;
        display = path.join(dir, spec.path.replace(/\//g, path.sep));
      }

      const ok = loadPluginPreview(url, id);
      if (!ok) return { ok: false, error: "预览视图不可用" };
      return { ok: true, url, display };
    } catch (err) {
      log.error("plugin:preview-load error:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("plugin:preview-visible", async (_event, visible: boolean) => {
    setPluginPreviewVisible(!!visible);
  });

  ipcMain.handle(
    "plugin:preview-bounds",
    async (
      _event,
      rect: { x: number; y: number; width: number; height: number }
    ) => {
      if (!rect) return;
      setPluginPreviewBounds({
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0,
      });
    }
  );

  log.info("插件管理 IPC 处理器已注册");
  return pluginManager;
}

export function teardownPluginHandlers(): void {
  manager?.disposeAllSync();
  void manager?.dispose();
}

export function resolvePluginDir(localId: number): string | null {
  return manager?.getPluginDirByLocalId(localId) ?? null;
}
