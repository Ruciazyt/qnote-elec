import type { Knex } from "knex";
import { log } from "../../main/utils/log";
import type {
  PublishedApp,
  PublishedAppInput,
  PublishedAppListResult,
  PublishedAppQuery,
} from "../../shared/cloudTypes";

/**
 * 共享存储 —— 一份接口，两个实现（本地 SQLite / 云端 D1）
 *
 * ## 边界
 *
 * 这里**只**管共享数据（发布出去的 APP 目录）。
 * 用户的私有数据（笔记、剪贴板、Todo、AI 对话）**不在这里**，
 * 它们永远留在本地 SQLite —— 见 docs/CLOUD-STORAGE.md。
 *
 * ## 为什么要抽这一层
 *
 * D1 与本地 SQLite 的差异集中在两处：怎么执行语句、怎么拿到自增 id。
 * 把这两点收进 `SqlExecutor`，上层的查询逻辑就能一字不改地复用 ——
 * 否则同一套 SQL 要写两遍，改一处忘一处是很常见的事故。
 *
 * ## 原子性
 *
 * D1 **没有交互式事务** —— 每条查询都包在自己的隐式事务里。
 * 唯一能拿到原子性的手段是 batch（一次请求发多条语句，全成或全滚）。
 * 所以「两条语句要么都成要么都不成」的场景一律走 `executor.batch()`。
 */

/** 共享存储的公开接口 */
export interface SharedStore {
  /** 后端标识 —— 界面上要显示「当前用的是本地还是云端」 */
  readonly backend: "local" | "d1" | "public";

  /** 建表（幂等） */
  init(): Promise<void>;

  /** 列出已发布的 APP */
  list(query?: PublishedAppQuery): Promise<PublishedAppListResult>;

  /** 按 id 取一条 */
  get(id: string): Promise<PublishedApp | null>;

  /** 发布 / 覆盖一条 */
  publish(input: PublishedAppInput, existingId?: string): Promise<PublishedApp>;

  /** 删除一条 */
  remove(id: string): Promise<boolean>;

  /** 给「被获取次数」加一 */
  incrementPulls(id: string): Promise<void>;

  /** 连通性检查 */
  check(): Promise<{ ok: boolean; error?: string; detail?: string }>;
}

/**
 * 语句执行器 —— 本地与 D1 的唯一差异所在
 *
 * 上层只认这三个方法，不关心底下是 sqlite3 还是 HTTP。
 */
export interface SqlExecutor {
  /** 执行一条读语句，返回行 */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * 执行一批语句 —— 原子
   *
   * 本地：走 knex 的真事务。
   * D1：走一次请求里的 batch（D1 上唯一的原子性来源）。
   */
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}

/* ============================================================
 * 共享表结构
 * ============================================================
 *
 * 一张表 `published_app`。刻意做得很窄 —— 这份数据所有人可见，
 * 不能带本机路径、私有笔记内容之类的东西。
 *
 * `id` 用字符串而不是自增整数：自增 id 在本地库和云端库里
 * 是两套完全不同的编号空间，跨后端切换时会撞。
 * 字符串 id 由发布时生成，两边一致。
 */

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

/** 表名常量 —— 别处引用统一走这里 */
export const PUBLISHED_APP_TABLE = "published_app";

/** 行 → 领域对象 */
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

/** 生成本地库与云端库共用的 id —— 短、带随机后缀，跨后端不会撞 */
export function generateAppId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `app_${Date.now().toString(36)}_${random}`;
}

/**
 * 共享存储的通用实现 —— 只依赖 SqlExecutor
 *
 * 本地与 D1 各传一个执行器进来，其余完全共用。
 */
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

    // 覆盖发布：保留原来的 pulls 与 created_at，只更新内容
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

  /** 覆盖发布时保留原记录的创建时间 */
  private async resolveCreatedAt(id: string, fallback: number): Promise<number> {
    try {
      const existing = await this.get(id);
      return existing?.createdAt ?? fallback;
    } catch {
      return fallback;
    }
  }
}

/** 限制每次最多取多少条 —— 防止一条 SQL 把整个云端库拖下来 */
function clampLimit(limit: number | undefined): number {
  const value = Number(limit ?? 50);
  if (!Number.isFinite(value)) return 50;
  return Math.min(200, Math.max(1, Math.floor(value)));
}

/**
 * 把用户输入的关键词包成 LIKE 的匹配模式
 *
 * ## 为什么要转义
 *
 * LIKE 里的 `%` 匹配任意长度的字符、`_` 匹配任意一个字符。
 * 用户搜 `%` 想找带百分号的条目，SQL 理解成了「匹配一切」——
 * 结果整个列表都显示出来，看着像搜索坏了。
 *
 * 转义后用 `ESCAPE '\'` 声明转义符，三个要转义的字符是
 * 反斜杠本身、`%`、`_`。顺序不能换：先转义反斜杠，
 * 否则后面补上的转义符自己又被转义一次。
 */
function likePattern(keyword: string): string {
  const escaped = keyword
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `%${escaped}%`;
}

/* ============================================================
 * 本地实现
 * ============================================================
 */

/**
 * 本地 SQLite 的执行器
 *
 * 本地这边有真正的交互式事务，所以 `batch` 走 knex 的
 * `DB.transaction` —— 语义比 D1 的 batch 更强（能回滚），
 * 但对外表现一致。
 */
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

/**
 * knex 的 raw 返回值五花八门 —— SELECT 是行数组，
 * INSERT 在 sqlite3 下是 `[lastID]`，UPDATE / DELETE 是 `changes`。
 * 这里统一成「行数组」。
 */
function normalizeLocalRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    // 已经是行数组（每项是对象）就原样返回
    if (result.length === 0) return [];
    if (typeof result[0] === "object" && result[0] !== null) {
      return result as Array<Record<string, unknown>>;
    }
    // `[lastID]` / `[changes]` —— 不是行，当空结果
    return [];
  }
  if (result && typeof result === "object") {
    return [result as Record<string, unknown>];
  }
  return [];
}

/** 建一个本地共享存储 */
export function createLocalSharedStore(DB: Knex): SharedStore {
  log.info("[cloud] 使用本地共享存储");
  return new SharedStoreOnExecutor("local", new LocalSqlExecutor(DB));
}
