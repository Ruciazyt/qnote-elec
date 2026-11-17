
export const ALLOWED_TABLE = "published_app";

const ALLOWED_STATEMENTS: RegExp[] = [
  /^SELECT\s+[\s\S]*\bFROM\s+published_app\b/i,
  /^INSERT\s+INTO\s+published_app\b/i,
  /^UPDATE\s+published_app\b/i,
  /^DELETE\s+FROM\s+published_app\b/i,
  /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+published_app\s*\(/i,
  /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+published_app_[\w]+\s+ON\s+published_app\s*\(/i,
];

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

export const MAX_SQL_LENGTH = 20_000;

export const MAX_STATEMENTS = 50;

export type CheckResult = { ok: true } | { ok: false; reason: string };

export function checkStatement(sql: unknown): CheckResult {
  if (typeof sql !== "string" || !sql.trim()) {
    return { ok: false, reason: "空语句" };
  }
  if (sql.length > MAX_SQL_LENGTH) {
    return { ok: false, reason: "语句过长" };
  }
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

export function normalizeParams(params: unknown): unknown[] {
  if (!Array.isArray(params)) return [];
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}
