import { ipcMain } from "electron";
import { log } from "../utils/log";
import {
  checkD1,
  checkEndpoint,
  describeCloudError,
  getApp,
  getConfig,
  listApps,
  markPulled,
  publishApp,
  removeApp,
  switchBackend,
  updateConfig,
} from "../../database/cloud/cloudManager";
import type {
  CloudBackend,
  CloudConnectionStatus,
  CloudStorageConfig,
  D1Config,
  PublishedApp,
  PublishedAppInput,
  PublishedAppListResult,
  PublishedAppQuery,
} from "../../shared/cloudTypes";

/**
 * 云端存储 —— IPC 层
 *
 * 通道前缀统一用 `cloud:`。
 *
 * ## 这里只管共享数据
 *
 * 用户私有的东西（笔记、剪贴板、Todo、AI 对话）不经过这些通道 ——
 * 它们永远在本地 SQLite。详见 docs/CLOUD-STORAGE.md。
 */

/** 结果类型：要么给数据，要么给一句中文原因 */
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: describeCloudError(error) };
}

export function registerCloudHandlers(): void {
  // ------------------------------------------------------------------
  // 配置与后端
  // ------------------------------------------------------------------

  /** 读当前配置 —— 界面用它显示「当前用的是本地还是云端」 */
  ipcMain.handle("cloud:get-config", async (): Promise<CloudStorageConfig> => {
    try {
      return await getConfig();
    } catch (error) {
      log.error("[cloud] 读取配置失败", error);
      return { backend: "local", d1: null, endpoint: null, lastCheck: null };
    }
  });

  /**
   * 保存配置
   *
   * 切到 d1 / public 时会先做真实的连通性检查 —— 配错了就别切，
   * 免得界面变成「连不上」的样子，用户还以为应用坏了。
   */
  ipcMain.handle(
    "cloud:save-config",
    async (
      _event,
      payload: {
        backend?: CloudBackend;
        d1?: D1Config | null;
        endpoint?: string | null;
      }
    ): Promise<Result<CloudStorageConfig>> => {
      try {
        const result = await updateConfig({
          backend: payload?.backend,
          d1: payload?.d1,
          endpoint: payload?.endpoint,
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

  /** 只切前后端，不动 D1 配置 */
  ipcMain.handle(
    "cloud:switch-backend",
    async (_event, backend: CloudBackend): Promise<Result<CloudStorageConfig>> => {
      try {
        const result = await switchBackend(backend === "d1" ? "d1" : backend === "public" ? "public" : "local");
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

  /** 只做连通性检查，不改配置 —— 设置页的「测试连接」按钮 */
  ipcMain.handle(
    "cloud:test-connection",
    async (
      _event,
      payload: { d1?: D1Config; endpoint?: string }
    ): Promise<CloudConnectionStatus> => {
      try {
        // 给了 endpoint 就测公共目录，没给就测直连 D1
        const endpoint = String(payload?.endpoint ?? "").trim();
        if (endpoint) {
          return await checkEndpoint(endpoint);
        }
        return await checkD1({
          accountId: String(payload?.d1?.accountId ?? "").trim(),
          databaseId: String(payload?.d1?.databaseId ?? "").trim(),
          apiToken: String(payload?.d1?.apiToken ?? "").trim(),
        });
      } catch (error) {
        return { ok: false, error: describeCloudError(error) };
      }
    }
  );

  // ------------------------------------------------------------------
  // 发布目录
  // ------------------------------------------------------------------

  /** 列出已发布的 APP */
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

  /** 取一条 */
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

  /**
   * 发布 / 更新一条 APP
   *
   * `existingId` 给了就是更新（保留原来的获取次数与发布时间），
   * 不给就是新建。
   */
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

  /** 删除一条 */
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

  /** 「被获取」计数加一 —— 别的机器导入时调它 */
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
