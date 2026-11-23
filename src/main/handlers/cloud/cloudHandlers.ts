
import { ipcMain } from "electron";
import { log } from "../../core/system/log";
import { readPublishMetadata } from "../../core/plugin/market/marketVersion";
import { checkPublishCompatibility } from "../../core/plugin/market/publishCheck";
import {
  checkCatalog,
  describeCloudError,
  getApp,
  getConfig,
  listApps,
  markPulled,
  publishApp,
  removeApp,
  switchBackend,
  updateConfig,
} from "../../../database/cloud/cloudManager";
import {
  resolveDefaultCatalogConfig,
  sanitizeCatalogConfig,
} from "../../../database/cloud/defaults";
import type {
  CatalogConfig,
  CloudBackend,
  CloudConnectionStatus,
  CloudStorageConfig,
  PublishedApp,
  PublishedAppInput,
  PublishedAppListResult,
  PublishedAppQuery,
} from "../../../shared/cloud/cloudTypes";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: describeCloudError(error) };
}

function readCatalogConfig(payload: { catalog?: CatalogConfig }): CatalogConfig {
  return (
    sanitizeCatalogConfig(payload?.catalog) ??
    resolveDefaultCatalogConfig() ?? {
      baseUrl: "",
      appId: "",
      publicKey: "",
      privateKey: "",
    }
  );
}

export function registerCloudHandlers(): void {
  ipcMain.handle("cloud:get-config", async (): Promise<CloudStorageConfig> => {
    try {
      return await getConfig();
    } catch (error) {
      log.error("[cloud] 读取配置失败", error);
      return { backend: "local", catalog: null, lastCheck: null };
    }
  });

  ipcMain.handle(
    "cloud:save-config",
    async (
      _event,
      payload: {
        backend?: CloudBackend;
        catalog?: CatalogConfig | null;
      }
    ): Promise<Result<CloudStorageConfig>> => {
      try {
        const result = await updateConfig({
          backend: payload?.backend,
          catalog: payload?.catalog,
        });
        if (!result.ok) {
          return { ok: false, error: result.error ?? "保存失败" };
        }
        return { ok: true, data: result.config };
      } catch (error) {
        log.error("[cloud] 保存配置失败", error);
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    "cloud:switch-backend",
    async (_event, backend: CloudBackend): Promise<Result<CloudStorageConfig>> => {
      try {
        const result = await switchBackend(backend === "catalog" ? "catalog" : "local");
        if (!result.ok) {
          return { ok: false, error: result.error ?? "切换失败" };
        }
        return { ok: true, data: result.config };
      } catch (error) {
        log.error("[cloud] 切换后端失败", error);
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    "cloud:test-connection",
    async (_event, payload: { catalog?: CatalogConfig }): Promise<CloudConnectionStatus> => {
      try {
        return await checkCatalog(readCatalogConfig(payload ?? {}));
      } catch (error) {
        return { ok: false, error: describeCloudError(error) };
      }
    }
  );

  ipcMain.handle(
    "cloud:list-apps",
    async (_event, query?: PublishedAppQuery): Promise<Result<PublishedAppListResult>> => {
      try {
        return { ok: true, data: await listApps(query) };
      } catch (error) {
        log.error("[cloud] 读取发布目录失败", error);
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    "cloud:get-app",
    async (_event, id: string): Promise<Result<PublishedApp | null>> => {
      try {
        return { ok: true, data: await getApp(String(id ?? "")) };
      } catch (error) {
        log.error("[cloud] 读取发布条目失败", error);
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    "cloud:publish-app",
    async (
      _event,
      input: PublishedAppInput,
      existingId?: string
    ): Promise<Result<PublishedApp>> => {
      try {
        const name = String(input?.name ?? "").trim();
        if (!name) {
          return { ok: false, error: "应用名不能为空" };
        }
        const manifest = String(input?.manifest ?? "");
        if (!manifest.trim()) {
          return { ok: false, error: "清单内容不能为空" };
        }

        const check = checkPublishCompatibility(manifest);
        if (!check.ok) {
          log.warn("[cloud] 发布前的网关兼容检查没通过", {
            issues: check.issues.length,
          });
          return { ok: false, error: check.message };
        }

        const metadata = readPublishMetadata(manifest);
        const dependencies =
          metadata.dependencies.length > 0
            ? metadata.dependencies
            : (input?.dependencies ?? []);

        return {
          ok: true,
          data: await publishApp(
            {
              name,
              description: String(input?.description ?? ""),
              author: String(input?.author ?? ""),
              manifest,
              repoUrl: String(input?.repoUrl ?? ""),
              tags: String(input?.tags ?? ""),
              bundle: String(input?.bundle ?? ""),
              version: metadata.version || String(input?.version ?? "").trim(),
              dependencies,
            },
            existingId ? String(existingId) : undefined
          ),
        };
      } catch (error) {
        log.error("[cloud] 发布失败", error);
        return fail(error);
      }
    }
  );

  ipcMain.handle(
    "cloud:remove-app",
    async (_event, id: string): Promise<Result<boolean>> => {
      try {
        return { ok: true, data: await removeApp(String(id ?? "")) };
      } catch (error) {
        log.error("[cloud] 删除发布条目失败", error);
        return fail(error);
      }
    }
  );

  ipcMain.handle("cloud:mark-pulled", async (_event, id: string): Promise<boolean> => {
    try {
      await markPulled(String(id ?? ""));
      return true;
    } catch (error) {
      log.error("[cloud] 更新获取次数失败", error);
      return false;
    }
  });

  log.info("云端存储 IPC 处理器已注册");
}
