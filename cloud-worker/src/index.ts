import {
  checkStatement,
  normalizeParams,
  MAX_STATEMENTS,
} from "./guard";

/**
 * QNote 公共目录 —— Cloudflare Worker 代理
 *
 * ## 它解决什么
 *
 * 「所有用户零配置连上同一个云端目录」绕不开一个问题：
 * 客户端总得有个凭据才能访问 D1。而 D1 的 API Token 是**账号级**的
 * （Cloudflare 文档原话："A Cloudflare API token with D1 access is
 * account-wide"），控制台里也**没法**只授权到单个库。
 *
 * 所以把 Token 内置进客户端行不通 —— 那等于把账号下所有 D1 库的
 * 写权限发给每一个装了你应用的人。
 *
 * 这个 Worker 就是那个「凭据留在 Cloudflare 侧」的位置：
 *
 * ```
 *   QNote 客户端 ──HTTP──> 这个 Worker ──D1 绑定──> D1 数据库
 *      无凭据               凭据不出服务端            只放 published_app
 * ```
 *
 * 客户端只需要知道 Worker 的**公开地址**（不是密钥，可以内置），
 * 于是所有用户开箱即用，零配置。
 *
 * ## 部署
 *
 *   cd cloud-worker
 *   npx wrangler d1 create qnote-apps     # 记下 database_id
 *   # 把 database_id 填进 wrangler.jsonc
 *   npx wrangler deploy
 *   # 记下输出的 https://qnote-catalog.<你的子域>.workers.dev
 *
 * 详细说明见 cloud-worker/README.md。
 */

/** Cloudflare 的 D1 绑定 */
interface Env {
  DB: D1Database;
}

/** 请求体里的一条语句 */
interface RawStatement {
  sql?: unknown;
  params?: unknown;
}

/** 统一 JSON 响应 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      // 客户端是桌面应用（不是浏览器），但加上 CORS 头可以让
      // 以后想做的网页版市场页直接用同一个 Worker。
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

/** 从请求体里取出语句列表 —— 单条 {sql,params} 或批量 {batch:[...]} */
function readStatements(body: unknown): Array<{ sql: string; params: unknown[] }> | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as { batch?: unknown; sql?: unknown; params?: unknown };

  if (Array.isArray(obj.batch)) {
    return obj.batch.map((entry) => {
      const item = (entry ?? {}) as RawStatement;
      return {
        sql: typeof item.sql === "string" ? item.sql : "",
        params: normalizeParams(item.params),
      };
    });
  }
  if (typeof obj.sql === "string") {
    return [{ sql: obj.sql, params: normalizeParams(obj.params) }];
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 预检：桌面端（Electron 主进程）用 Node fetch，不走 CORS；
    // 但以后想给网页版市场页复用同一个 Worker，就得有它。
    if (request.method === "OPTIONS") {
      return json({ success: true }, 204);
    }
    if (request.method !== "POST") {
      return json({ success: false, errors: [{ code: 1000, message: "只接受 POST" }] }, 405);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, errors: [{ code: 1000, message: "请求体不是 JSON" }] }, 400);
    }

    const statements = readStatements(body);
    if (!statements || statements.length === 0) {
      return json({ success: false, errors: [{ code: 1000, message: "没有可执行的语句" }] }, 400);
    }
    if (statements.length > MAX_STATEMENTS) {
      return json(
        { success: false, errors: [{ code: 1000, message: `一次最多 ${MAX_STATEMENTS} 条语句` }] },
        400
      );
    }

    // 逐条校验 —— 有一条不过就整体拒绝，不给「部分执行」的机会
    for (const statement of statements) {
      const check = checkStatement(statement.sql);
      if (!check.ok) {
        return json(
          {
            success: false,
            errors: [{ code: 1000, message: `语句被拒绝：${check.reason}` }],
          },
          400
        );
      }
    }

    try {
      // env.DB.batch 是一条 SQL 事务 —— 任何一条失败整批回滚。
      // 这跟客户端那边的 batch 语义是对齐的。
      const prepared = statements.map((statement) => {
        const stmt = env.DB.prepare(statement.sql);
        return statement.params.length > 0 ? stmt.bind(...statement.params) : stmt;
      });

      // all() 返回单个 D1Result（对象），batch() 返回 D1Result 数组。
      // 客户端那边统一按「数组、且下标与语句一一对应」来读，
      // 所以单条也要包成数组。
      const results =
        statements.length === 1
          ? [await prepared[0].all()]
          : await env.DB.batch(prepared);

      return json({ success: true, result: results });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ success: false, errors: [{ code: 1000, message }] }, 200);
    }
  },
};
