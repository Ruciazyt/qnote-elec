import {
  checkStatement,
  normalizeParams,
  MAX_STATEMENTS,
} from "./guard";


interface Env {
  DB: D1Database;
}

interface RawStatement {
  sql?: unknown;
  params?: unknown;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

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
      const prepared = statements.map((statement) => {
        const stmt = env.DB.prepare(statement.sql);
        return statement.params.length > 0 ? stmt.bind(...statement.params) : stmt;
      });

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
