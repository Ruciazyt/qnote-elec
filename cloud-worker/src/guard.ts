/**
 * 公共目录的 SQL 白名单
 *
 * ## 为什么要有这一层
 *
 * Worker 的地址是**公开的**（内置在客户端里），谁都能往里 POST。
 * 如果它是无条件转发 SQL，那等于把整个 D1 数据库的全权暴露在公网上 ——
 * 任何人都能 `DROP TABLE`。
 *
 * 所以这里把能跑的语句钉死成一小组：
 *
 * ```
 * SELECT  … FROM published_app …
 * INSERT  INTO published_app …
 * UPDATE  published_app …
 * DELETE  FROM published_app …
 * CREATE  TABLE/INDEX IF NOT EXISTS published_app…
 * ```
 *
 * 客户端发出的语句就这几种（见 src/database/cloud/sharedStore.ts），
 * 少一条都不影响功能。
 *
 * ## 两道防线
 *
 * 1. **形状匹配** —— 上面那几条正则，锚在语句开头
 * 2. **关键词扫描** —— 再扫一遍禁掉的词，把 DDL 破坏语句和 PRAGMA 挡掉
 *
 * 光有形状匹配不够：锚点只管开头，注释、CTE、嵌套都可能有意外的形状。
 * 两道一起上，注入面才真正关上。
 */

/** 唯一允许操作的表 */
export const ALLOWED_TABLE = "published_app";

/** 允许的语句形状 */
const ALLOWED_STATEMENTS: RegExp[] = [
  /^SELECT\s+[\s\S]*\bFROM\s+published_app\b/i,
  /^INSERT\s+INTO\s+published_app\b/i,
  /^UPDATE\s+published_app\b/i,
  /^DELETE\s+FROM\s+published_app\b/i,
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+published_app\s*\(/i,
  /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+published_app_[\w]+\s+ON\s+published_app\s*\(/i,
];

/**
 * 一律拒绝的关键词
 *
 * 上面那些正则已经限定了语句形状，这里是第二道防线。
 * 注意它们都是**词边界**匹配 —— 免得误伤列名。
 */
const FORBIDDEN_KEYWORDS = [
  "DROP",
  "ALTER",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "TRIGGER",
  "VIEW",
];

/** 单条语句的最大长度 —— D1 自身上限 100KB，这里收得更紧 */
export const MAX_SQL_LENGTH = 20_000;

/** 单次请求最多几条语句 —— D1 batch 上限是 1000（免费版）/ 10000（付费版） */
export const MAX_STATEMENTS = 50;

/** 校验结果 */
export type CheckResult = { ok: true } | { ok: false; reason: string };

/** 校验一条语句 */
export function checkStatement(sql: unknown): CheckResult {
  if (typeof sql !== "string" || !sql.trim()) {
    return { ok: false, reason: "空语句" };
  }
  if (sql.length > MAX_SQL_LENGTH) {
    return { ok: false, reason: "语句过长" };
  }
  // 多语句拼接是最直接的注入面：客户端的语句里一个分号都没有，
  // 出现了就说明不是我们发的那种，直接拒。
  if (sql.includes(";")) {
    return { ok: false, reason: "不允许一次发多条语句" };
  }
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(sql)) {
      return { ok: false, reason: `不允许的操作：${keyword}` };
    }
  }
  if (!ALLOWED_STATEMENTS.some((re) => re.test(sql.trim()))) {
    return { ok: false, reason: `只允许操作 ${ALLOWED_TABLE} 表` };
  }
  return { ok: true };
}

/**
 * 把参数规整成 D1 能绑定的值
 *
 * undefined 会被 D1 拒（它只认 null），布尔值要转成 0/1 ——
 * SQLite 没有布尔类型。
 */
export function normalizeParams(params: unknown): unknown[] {
  if (!Array.isArray(params)) return [];
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}
