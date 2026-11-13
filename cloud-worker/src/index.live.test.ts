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

/**
 * 公共目录 Worker 的**真机**回归
 *
 * 这里的 D1 是真的（wrangler dev 的 miniflare），不是替身。
 * 它验的是单元测试验不到的那一层：
 *
 *   - 白名单**不会误伤**客户端实际发出的语句（尤其是 batch 里的 DDL）
 *   - 响应体的形状真的跟客户端对得上
 *   - D1 的 batch 真的整批回滚
 *
 * ## 怎么跑
 *
 * 先起 Worker（本地 D1）：
 *
 * ```bash
 * cd cloud-worker
 * npx wrangler dev --local --port 8811
 * ```
 *
 * 再跑测试：
 *
 * ```bash
 * pnpm test -- ../../cloud-worker/src/index.live.test.ts
 * ```
 *
 * Worker 没起时这个文件整体跳过 —— 不让「没起 Worker」变成一条红测试。
 */

const WORKER_URL =
  process.env.QNOTE_WORKER_URL ?? "http://127.0.0.1:8811";

/** Worker 在不在 */
let reachable = false;

beforeAll(async () => {
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
      signal: AbortSignal.timeout(3000),
    });
    //  Worker 起来了就会回「语句被拒绝」（SELECT 1 不在白名单里），
    //  连不上才是真的没起来
    reachable = response.status > 0;
  } catch {
    reachable = false;
  }
});

/** 造一个连到真 Worker 的客户端 */
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

    // init 发的是两条 DDL，走 batch —— 这是最容易踩白名单的地方
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

    // 关键词转义在真 D1 上也要对
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

    // 第一条也不能留下
    const list = await store.list();
    expect(list.apps.find((a) => a.id === "rollback_probe")).toBeUndefined();
  });
});
