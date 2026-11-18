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
  readonly backend: "local" | "d1" | "public";

  init(): Promise<void>;

  list(query?: PublishedAppQuery): Promise<PublishedAppListResult>;

  get(id: string): Promise<PublishedApp | null>;

  publish(input: PublishedAppInput, existingId?: string): Promise<PublishedApp>;

  remove(id: string): Promise<boolean>;

  incrementPulls(id: string): Promise<void>;

  check(): Promise<{ ok: boolean; error?: string; detail?: string }>;
}

export interface SqlExecutor {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}


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
  updated_at INTEGER NOT NULL DEFAULT 0
)
`;

const CREATE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS published_app_updated_at_idx ON published_app(updated_at DESC)
`;

export const PUBLISHED_APP_TABLE = "published_app";

function rowToApp(row: Record<string, unknown>): PublishedApp {
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
  };
}

export function generateAppId(): string {
  const random = randomBytes(4).toString("hex");
  return `app_${Date.now().toString(36)}_${random}`;
}

export class SharedStoreOnExecutor implements SharedStore {
  constructor(
    readonly backend: "local" | "d1" | "public",
    private readonly executor: SqlExecutor
  ) {}

  async init(): Promise<void> {
    await this.executor.batch([
      { sql: CREATE_TABLE_SQL },
      { sql: CREATE_INDEX_SQL },
    ]);
  }

  async list(query: PublishedAppQuery = {}): Promise<PublishedAppListResult> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Number(query.offset ?? 0));
    const keyword = (query.keyword ?? "").trim();

    const where = keyword
      ? "WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' " +
        "OR tags LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\'"
      : "";
    const params = keyword
      ? [likePattern(keyword), likePattern(keyword), likePattern(keyword), likePattern(keyword)]
      : [];

    const countRows = await this.executor.all<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${PUBLISHED_APP_TABLE} ${where}`,
      params
    );
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await this.executor.all<Record<string, unknown>>(
      `SELECT * FROM ${PUBLISHED_APP_TABLE} ${where} ` +
        `ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { apps: rows.map(rowToApp), total };
  }

  async get(id: string): Promise<PublishedApp | null> {
    const rows = await this.executor.all<Record<string, unknown>>(
      `SELECT * FROM ${PUBLISHED_APP_TABLE} WHERE id = ? LIMIT 1`,
      [id]
    );
    const row = rows[0];
    return row ? rowToApp(row) : null;
  }

  async publish(input: PublishedAppInput, existingId?: string): Promise<PublishedApp> {
    const id = existingId ?? generateAppId();
    const now = Date.now();
    const createdAt = existingId ? await this.resolveCreatedAt(id, now) : now;

    const record = {
      id,
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      author: (input.author ?? "").trim(),
      manifest: input.manifest,
      repo_url: (input.repoUrl ?? "").trim(),
      tags: (input.tags ?? "").trim(),
      pulls: 0,
      created_at: createdAt,
      updated_at: now,
    };

    await this.executor.batch([
      {
        sql:
          `INSERT INTO ${PUBLISHED_APP_TABLE} ` +
          `(id, name, description, author, manifest, repo_url, tags, pulls, created_at, updated_at) ` +
          `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
          `ON CONFLICT(id) DO UPDATE SET ` +
          `name = excluded.name, description = excluded.description, author = excluded.author, ` +
          `manifest = excluded.manifest, repo_url = excluded.repo_url, tags = excluded.tags, ` +
          `updated_at = excluded.updated_at`,
        params: [
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
        ],
      },
    ]);

    const saved = await this.get(id);
    if (!saved) {
      throw new Error("发布失败：写入后读不回来");
    }
    return saved;
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    await this.executor.batch([
      { sql: `DELETE FROM ${PUBLISHED_APP_TABLE} WHERE id = ?`, params: [id] },
    ]);
    return true;
  }

  async incrementPulls(id: string): Promise<void> {
    await this.executor.batch([
      {
        sql: `UPDATE ${PUBLISHED_APP_TABLE} SET pulls = pulls + 1 WHERE id = ?`,
        params: [id],
      },
    ]);
  }

  async check(): Promise<{ ok: boolean; error?: string; detail?: string }> {
    try {
      await this.executor.all(`SELECT 1 AS ok`);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveCreatedAt(id: string, fallback: number): Promise<number> {
    try {
      const existing = await this.get(id);
      return existing?.createdAt ?? fallback;
    } catch {
      return fallback;
    }
  }
}

function clampLimit(limit: number | undefined): number {
  const value = Number(limit ?? 50);
  if (!Number.isFinite(value)) return 50;
  return Math.min(200, Math.max(1, Math.floor(value)));
}

function likePattern(keyword: string): string {
  const escaped = keyword
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `%${escaped}%`;
}


export class LocalSqlExecutor implements SqlExecutor {
  constructor(private readonly DB: Knex) {}

  async all<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.DB.raw(sql, params as never[]);
    return normalizeLocalRows(result) as T[];
  }

  async batch(
    statements: Array<{ sql: string; params?: unknown[] }>
  ): Promise<void> {
    if (statements.length === 0) return;
    await this.DB.transaction(async (trx) => {
      for (const statement of statements) {
        await trx.raw(statement.sql, (statement.params ?? []) as never[]);
      }
    });
  }
}

function normalizeLocalRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    if (result.length === 0) return [];
    if (typeof result[0] === "object" && result[0] !== null) {
      return result as Array<Record<string, unknown>>;
    }
    return [];
  }
  if (result && typeof result === "object") {
    return [result as Record<string, unknown>];
  }
  return [];
}

export function createLocalSharedStore(DB: Knex): SharedStore {
  log.info("[cloud] 使用本地共享存储");
  return new SharedStoreOnExecutor("local", new LocalSqlExecutor(DB));
}
