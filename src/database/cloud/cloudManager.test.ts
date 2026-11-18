// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import { checkStatement } from "../../../cloud-worker/src/guard";
import { checkEndpoint } from "./cloudManager";

describe("公共目录连通性检查", () => {
  let server: http.Server;
  let port: number;
  const received: string[] = [];

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const statements = Array.isArray(body.batch)
        ? body.batch
        : [{ sql: body.sql, params: body.params }];

      let failure: string | null = null;
      for (const statement of statements) {
        const check = checkStatement(statement.sql);
        if (!check.ok) {
          failure = check.reason;
          break;
        }
      }

      if (failure) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            errors: [{ code: 1000, message: `语句被拒绝：${failure}` }],
          })
        );
        return;
      }

      received.push(...statements.map((s: { sql: string }) => s.sql));

      const result = statements.map((s: { sql: string }) => {
        const isCount =
          /^SELECT\s+COUNT\(\*\)\s+AS\s+n\s+FROM\s+published_app/i.test(s.sql);
        return {
          success: true,
          results: isCount ? [{ n: 0 }] : [],
          meta: { changes: 0 },
        };
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("检查通过 —— 发出去的语句都在 Worker 白名单内", async () => {
    received.length = 0;

    const status = await checkEndpoint(`http://127.0.0.1:${port}`);

    expect(status.ok).toBe(true);
    expect(status.error).toBeUndefined();
    expect(status.detail).toContain("已连接公共目录");
    expect(received.some((sql) => /sqlite_master/i.test(sql))).toBe(false);
  });

  it("白名单拒绝时给出可读原因，而不是一句连不上", async () => {
    const status = await checkEndpoint("http://127.0.0.1:1");

    expect(status.ok).toBe(false);
    expect(status.error).toBeTruthy();
  });
});