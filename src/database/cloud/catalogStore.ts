
import { log } from "../../main/core/system/log";
import { CatalogClient, type CatalogTransport } from "./catalogClient";
import { serializeDependencies } from "../../main/core/plugin/market/marketVersion";
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
    const version = (input.version ?? "").trim();
    const dependencies = input.dependencies ?? [];

    const optional: Record<string, unknown> = {};
    if (bundle) optional.bundle = bundle;
    if (version) optional.version = version;
    if (dependencies.length > 0) {
      optional.dependencies = serializeDependencies(dependencies);
    }

    const dropped = new Set<string>();

    const send = async (): Promise<void> => {
      const body = { ...fields, ...optional };
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
      await send();
    } catch (error) {
      const unsupported = unsupportedFields(error, optional);
      if (unsupported.length === 0) throw error;
      log.warn("[cloud] 公共目录还不支持这些列，本次只发布清单", {
        fields: unsupported,
      });
      for (const key of unsupported) {
        delete optional[key];
        dropped.add(key);
      }
      await send();
    }

    const saved = await this.get(id);
    if (!saved) {
      throw new Error("发布失败：写入后读不回来");
    }
    if (dropped.has("bundle") || (bundle && !saved.bundle)) {
      saved.bundleDropped = true;
    }
    if (dropped.has("version") || (version && !saved.version)) {
      saved.versionDropped = true;
    }
    if (
      dropped.has("dependencies") ||
      (dependencies.length > 0 && (saved.dependencies?.length ?? 0) === 0)
    ) {
      saved.dependenciesDropped = true;
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

const OPTIONAL_FIELDS = ["bundle", "version", "dependencies"];

function unsupportedFields(
  error: unknown,
  sent: Record<string, unknown>
): string[] {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return OPTIONAL_FIELDS.filter(
    (field) => field in sent && new RegExp(field, "i").test(message)
  );
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
