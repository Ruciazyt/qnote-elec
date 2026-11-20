
import { log } from "../../main/core/system/log";
import { CatalogClient, type CatalogTransport } from "./catalogClient";
import {
  clampLimit,
  escapeKeyword,
  generateAppId,
  rowToApp,
  type SharedStore,
} from "./sharedStore";
import type {
  PublishedApp,
  PublishedAppInput,
  PublishedAppListResult,
  PublishedAppQuery,
} from "../../shared/cloud/cloudTypes";

export const ENDPOINT_LIST = "/apps_list";
export const ENDPOINT_COUNT = "/apps_count";
export const ENDPOINT_GET = "/apps_get";
export const ENDPOINT_PUBLISH = "/apps_publish";
export const ENDPOINT_UPDATE = "/apps_update";
export const ENDPOINT_REMOVE = "/apps_remove";
export const ENDPOINT_MARK_PULLED = "/apps_mark_pulled";

export class CatalogSharedStore implements SharedStore {
  readonly backend = "catalog";

  constructor(private readonly client: CatalogTransport) {}

  async init(): Promise<void> {
    await this.client.request({
      method: "GET",
      path: ENDPOINT_COUNT,
      query: { keyword: "" },
    });
  }

  async list(query: PublishedAppQuery = {}): Promise<PublishedAppListResult> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Number(query.offset ?? 0));
    const keyword = escapeKeyword((query.keyword ?? "").trim());

    const [listResult, countResult] = await Promise.all([
      this.client.request({
        method: "GET",
        path: ENDPOINT_LIST,
        query: { keyword, limit, offset },
      }),
      this.client.request({
        method: "GET",
        path: ENDPOINT_COUNT,
        query: { keyword },
      }),
    ]);

    return {
      apps: listResult.rows.map(rowToApp),
      total: Number(countResult.rows[0]?.n ?? 0),
    };
  }

  async get(id: string): Promise<PublishedApp | null> {
    const result = await this.client.request({
      method: "GET",
      path: ENDPOINT_GET,
      query: { id },
    });
    const row = result.rows[0];
    return row ? rowToApp(row) : null;
  }

  async publish(
    input: PublishedAppInput,
    existingId?: string
  ): Promise<PublishedApp> {
    const id = existingId ?? generateAppId();
    const now = Date.now();

    const fields = {
      id,
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      author: (input.author ?? "").trim(),
      manifest: input.manifest,
      repo_url: (input.repoUrl ?? "").trim(),
      tags: (input.tags ?? "").trim(),
      updated_at: now,
    };

    const bundle = input.bundle ?? "";
    let bundleDropped = false;

    const send = async (withBundle: boolean): Promise<void> => {
      const body = withBundle && bundle ? { ...fields, bundle } : fields;
      if (existingId) {
        await this.client.request({
          method: "POST",
          path: ENDPOINT_UPDATE,
          body,
        });
      } else {
        await this.client.request({
          method: "POST",
          path: ENDPOINT_PUBLISH,
          body: { ...body, pulls: 0, created_at: now },
        });
      }
    };

    try {
      await send(true);
    } catch (error) {
      if (!bundle || !mentionsBundle(error)) throw error;
      log.warn("[cloud] 公共目录还不支持资源列，本次只发布清单", error);
      await send(false);
      bundleDropped = true;
    }

    const saved = await this.get(id);
    if (!saved) {
      throw new Error("发布失败：写入后读不回来");
    }
    if (bundleDropped || (bundle && !saved.bundle)) {
      saved.bundleDropped = true;
    }
    return saved;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.client.request({
      method: "POST",
      path: ENDPOINT_REMOVE,
      body: { id },
    });
    return true;
  }

  async incrementPulls(id: string): Promise<void> {
    await this.client.request({
      method: "POST",
      path: ENDPOINT_MARK_PULLED,
      body: { id },
    });
  }

  async check(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    try {
      const result = await this.client.request({
        method: "GET",
        path: ENDPOINT_COUNT,
        query: { keyword: "" },
      });
      return { ok: true, detail: `已连接公共目录，现有 ${result.rows[0]?.n ?? 0} 个应用` };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function mentionsBundle(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /bundle/i.test(message);
}

export function createCatalogSharedStore(config: {
  baseUrl: string;
  appId: string;
  publicKey: string;
  privateKey: string;
}): { store: SharedStore; client: CatalogTransport } {
  const client = new CatalogClient(config);
  log.info("[cloud] 使用公共目录（TiDB Cloud Data Service）", {
    baseUrl: config.baseUrl,
    appId: config.appId,
  });
  return { store: new CatalogSharedStore(client), client };
}
