import { describe, it, expect, beforeAll } from "vitest";
import { vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import { D1Client } from "../../src/database/cloud/d1Client";
import { D1SqlExecutor } from "../../src/database/cloud/d1Store";
import { SharedStoreOnExecutor } from "../../src/database/cloud/sharedStore";


const WORKER_URL =
  process.env.QNOTE_WORKER_URL ?? "http://127.0.0.1:8811";

let reachable = false;

beforeAll(async () => {
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
      signal: AbortSignal.timeout(3000),
    });
    reachable = response.status > 0;
  } catch {
    reachable = false;
  }
});

function makeStore() {
  const client = new D1Client({ endpoint: WORKER_URL });
  return {
    client,
    store: new SharedStoreOnExecutor("public", new D1SqlExecutor(client)),
  };
}

describe("公共目录 Worker（真 D1）", () => {
  it("客户端实际发的语句都能过白名单", async () => {
    if (!reachable) return;
    const { store } = makeStore();

    await store.init();

    const published = await store.publish({
      name: "番茄钟",
      description: "一个网页版番茄钟",
      author: "someone",
      manifest: '{"name":"番茄钟","command":"python main.py"}',
      repoUrl: "https://github.com/x/y",
      tags: "工具,计时",
    });
    expect(published.name).toBe("番茄钟");
    expect(published.id.startsWith("app_")).toBe(true);

    const listed = await store.list();
    expect(listed.total).toBeGreaterThan(0);

    expect((await store.list({ keyword: "%" })).total).toBe(0);

    await store.remove(published.id);
  });

  it("白名单拦得住危险语句", async () => {
    if (!reachable) return;
    const dangerous = [
      "DROP TABLE published_app",
      "SELECT * FROM note",
      "PRAGMA table_info(published_app)",
      "SELECT * FROM published_app; DROP TABLE published_app",
    ];
    for (const sql of dangerous) {
      const response = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const payload = await response.json();
      expect(payload.success, `应该拒绝：${sql}`).toBe(false);
    }
  });

  it("batch 一条失败 → 整批回滚", async () => {
    if (!reachable) return;
    const { client, store } = makeStore();
    await store.init();

    await expect(
      client.batch([
        { sql: "INSERT INTO published_app (id, name) VALUES ('rollback_probe', 'X')" },
        { sql: "INSERT INTO 不存在的表 (id) VALUES ('y')" },
      ])
    ).rejects.toThrow();

    const list = await store.list();
    expect(list.apps.find((a) => a.id === "rollback_probe")).toBeUndefined();
  });
});
