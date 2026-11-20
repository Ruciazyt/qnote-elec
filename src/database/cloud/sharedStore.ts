
import { randomBytes } from "node:crypto";
import type { Knex } from "knex";
import { log } from "../../main/core/system/log";
import type {
  PublishedApp,
  PublishedAppInput,
  PublishedAppListResult,
  PublishedAppQuery,
} from "../../shared/cloud/cloudTypes";

export interface SharedStore {
  readonly backend: "local" | "catalog";

  init(): Promise<void>;

  list(query?: PublishedAppQuery): Promise<PublishedAppListResult>;

  get(id: string): Promise<PublishedApp | null>;

  publish(input: PublishedAppInput, existingId?: string): Promise<PublishedApp>;

  remove(id: string): Promise<boolean>;

  incrementPulls(id: string): Promise<void>;

  check(): Promise<{ ok: boolean; error?: string; detail?: string }>;
}

export const PUBLISHED_APP_TABLE = "published_app";

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS published_app (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  manifest TEXT NOT NULL DEFAULT '',
  repo_url TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  pulls INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  bundle TEXT NOT NULL DEFAULT ''
)
`;

export function rowToApp(row: Record<string, unknown>): PublishedApp {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    author: String(row.author ?? ""),
    manifest: String(row.manifest ?? ""),
    repoUrl: String(row.repo_url ?? ""),
    tags: String(row.tags ?? ""),
    pulls: Number(row.pulls ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    bundle: String(row.bundle ?? "") || undefined,
  };
}

export function generateAppId(): string {
  const random = randomBytes(4).toString("hex");
  return `app_${Date.now().toString(36)}_${random}`;
}

export function escapeKeyword(keyword: string): string {
  return keyword
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export function likePattern(keyword: string): string {
  return `%${escapeKeyword(keyword)}%`;
}

export function clampLimit(limit: number | undefined): number {
  const value = Number(limit ?? 50);
  if (!Number.isFinite(value)) return 50;
  return Math.min(200, Math.max(1, Math.floor(value)));
}

export class LocalSharedStore implements SharedStore {
  readonly backend = "local";

  constructor(private readonly DB: Knex) {}

  async init(): Promise<void> {
    await this.DB.raw(CREATE_TABLE_SQL);
    await this.ensureBundleColumn();
  }

  private async ensureBundleColumn(): Promise<void> {
    const rows = await this.DB.raw(`PRAGMA table_info(${PUBLISHED_APP_TABLE})`);
    const columns = Array.isArray(rows)
      ? rows.map((row) => String((row as Record<string, unknown>).name ?? ""))
      : [];
    if (columns.length === 0 || columns.includes("bundle")) return;
    await this.DB.raw(
      `ALTER TABLE ${PUBLISHED_APP_TABLE} ADD COLUMN bundle TEXT NOT NULL DEFAULT ''`
    );
    log.info("[cloud] 本地共享存储补上 bundle 列");
  }

  async list(query: PublishedAppQuery = {}): Promise<PublishedAppListResult> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Number(query.offset ?? 0));
    const keyword = (query.keyword ?? "").trim();

    const where = keyword
      ? `WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' ` +
        `OR tags LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\'`
      : "";
    const params = keyword
      ? [
          likePattern(keyword),
          likePattern(keyword),
          likePattern(keyword),
          likePattern(keyword),
        ]
      : [];

    const countRows = await this.DB.raw(
      `SELECT COUNT(*) AS n FROM ${PUBLISHED_APP_TABLE} ${where}`,
      params as never[]
    );
    const total = Number(firstRow(countRows)?.n ?? 0);

    const rows = await this.DB.raw(
      `SELECT id, name, description, author, manifest, repo_url, tags, ` +
        `pulls, created_at, updated_at FROM ${PUBLISHED_APP_TABLE} ${where} ` +
        "ORDER BY updated_at DESC LIMIT ? OFFSET ?",
      [...params, limit, offset] as never[]
    );

    return { apps: rows.map((row) => rowToApp(row)), total };
  }

  async get(id: string): Promise<PublishedApp | null> {
    const rows = await this.DB.raw(
      `SELECT * FROM ${PUBLISHED_APP_TABLE} WHERE id = ? LIMIT 1`,
      [id] as never[]
    );
    const row = firstRow(rows);
    return row ? rowToApp(row) : null;
  }

  async publish(
    input: PublishedAppInput,
    existingId?: string
  ): Promise<PublishedApp> {
    const id = existingId ?? generateAppId();
    const now = Date.now();
    const existing = existingId ? await this.get(id) : null;

    const record = {
      id,
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      author: (input.author ?? "").trim(),
      manifest: input.manifest,
      repo_url: (input.repoUrl ?? "").trim(),
      tags: (input.tags ?? "").trim(),
      pulls: 0,
      created_at: existing?.createdAt ?? now,
      updated_at: now,
      bundle: input.bundle ?? "",
    };

    if (existing) {
      await this.DB.raw(
        `UPDATE ${PUBLISHED_APP_TABLE} SET name = ?, description = ?, author = ?, ` +
          "manifest = ?, repo_url = ?, tags = ?, bundle = ?, updated_at = ? WHERE id = ?",
        [
          record.name,
          record.description,
          record.author,
          record.manifest,
          record.repo_url,
          record.tags,
          record.bundle,
          record.updated_at,
          record.id,
        ] as never[]
      );
    } else {
      await this.DB.raw(
        `INSERT INTO ${PUBLISHED_APP_TABLE} ` +
          "(id, name, description, author, manifest, repo_url, tags, pulls, created_at, updated_at, bundle) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          record.id,
          record.name,
          record.description,
          record.author,
          record.manifest,
          record.repo_url,
          record.tags,
          record.pulls,
          record.created_at,
          record.updated_at,
          record.bundle,
        ] as never[]
      );
    }

    const saved = await this.get(id);
    if (!saved) {
      throw new Error("发布失败：写入后读不回来");
    }
    return saved;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.DB.raw(`DELETE FROM ${PUBLISHED_APP_TABLE} WHERE id = ?`, [
      id,
    ] as never[]);
    return true;
  }

  async incrementPulls(id: string): Promise<void> {
    await this.DB.raw(
      `UPDATE ${PUBLISHED_APP_TABLE} SET pulls = pulls + 1 WHERE id = ?`,
      [id] as never[]
    );
  }

  async check(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    try {
      await this.DB.raw("SELECT 1 AS ok");
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) {
    const row = result[0];
    return row && typeof row === "object"
      ? (row as Record<string, unknown>)
      : undefined;
  }
  if (result && typeof result === "object") {
    return result as Record<string, unknown>;
  }
  return undefined;
}

export function createLocalSharedStore(DB: Knex): SharedStore {
  log.info("[cloud] 使用本地共享存储");
  return new LocalSharedStore(DB);
}
