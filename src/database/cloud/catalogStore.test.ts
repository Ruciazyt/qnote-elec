// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import {
  CatalogSharedStore,
  ENDPOINT_COUNT,
  ENDPOINT_GET,
  ENDPOINT_LIST,
  ENDPOINT_MARK_PULLED,
  ENDPOINT_PUBLISH,
  ENDPOINT_REMOVE,
  ENDPOINT_UPDATE,
} from "./catalogStore";
import { CatalogError, type CatalogRequest, type CatalogResult } from "./catalogClient";

const SAMPLE = {
  name: "番茄钟",
  description: "一个网页版番茄钟",
  author: "someone",
  manifest: '{"name":"番茄钟","command":"python main.py"}',
  repoUrl: "https://github.com/example/pomodoro",
  tags: "工具,计时",
};

function ok(rows: Array<Record<string, unknown>> = []): CatalogResult {
  return {
    columns: [],
    rows,
    code: 200,
    message: "Query OK",
    rowCount: rows.length,
    rowAffect: 0,
  };
}

class FakeCatalogTransport {
  readonly requests: CatalogRequest[] = [];

  private readonly table: Array<Record<string, unknown>> = [];

  async request(req: CatalogRequest): Promise<CatalogResult> {
    this.requests.push(req);
    const keyword = String(req.query?.keyword ?? req.body?.keyword ?? "");
    const id = String(req.query?.id ?? req.body?.id ?? "");

    switch (req.path) {
      case ENDPOINT_LIST: {
        const limit = Number(req.query?.limit ?? 50);
        const offset = Number(req.query?.offset ?? 0);
        return ok(this.filtered(keyword).slice(offset, offset + limit));
      }
      case ENDPOINT_COUNT:
        return ok([{ n: this.filtered(keyword).length }]);
      case ENDPOINT_GET: {
        const row = this.table.find((item) => item.id === id);
        return ok(row ? [{ ...row }] : []);
      }
      case ENDPOINT_PUBLISH:
        this.table.push({ ...req.body });
        return ok([]);
      case ENDPOINT_UPDATE: {
        const row = this.table.find((item) => item.id === id);
        if (row) Object.assign(row, req.body);
        return ok([]);
      }
      case ENDPOINT_REMOVE: {
        const index = this.table.findIndex((item) => item.id === id);
        if (index >= 0) this.table.splice(index, 1);
        return ok([]);
      }
      case ENDPOINT_MARK_PULLED: {
        const row = this.table.find((item) => item.id === id);
        if (row) row.pulls = Number(row.pulls ?? 0) + 1;
        return ok([]);
      }
      default:
        throw new CatalogError("endpoint not found", 404);
    }
  }

  private filtered(keyword: string): Array<Record<string, unknown>> {
    const needle = keyword.replace(/\\(.)/g, "$1");
    const matched = needle
      ? this.table.filter((row) =>
          [row.name, row.description, row.tags, row.author].some((value) =>
            String(value ?? "").includes(needle)
          )
        )
      : [...this.table];
    return matched.sort(
      (a, b) => Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0)
    );
  }
}

describe("公共目录共享存储", () => {
  let transport: FakeCatalogTransport;
  let store: CatalogSharedStore;

  beforeEach(() => {
    transport = new FakeCatalogTransport();
    store = new CatalogSharedStore(transport);
  });

  it("init 会打一次计数端点，确认目录活着", async () => {
    await store.init();
    expect(transport.requests.map((r) => r.path)).toEqual([ENDPOINT_COUNT]);
  });

  it("发布走 publish 端点，取回走 get 端点", async () => {
    await store.init();
    transport.requests.length = 0;

    const published = await store.publish(SAMPLE);

    const paths = transport.requests.map((r) => r.path);
    expect(paths).toEqual([ENDPOINT_PUBLISH, ENDPOINT_GET]);
    expect(published.name).toBe("番茄钟");
    expect(published.id.startsWith("app_")).toBe(true);
  });

  it("覆盖发布走 update 端点，且不带 pulls 与创建时间", async () => {
    await store.init();
    const first = await store.publish(SAMPLE);
    transport.requests.length = 0;

    const updated = await store.publish({ ...SAMPLE, name: "改过的名字" }, first.id);

    const update = transport.requests.find((r) => r.path === ENDPOINT_UPDATE);
    expect(update).toBeTruthy();
    expect(update?.body).not.toHaveProperty("pulls");
    expect(update?.body).not.toHaveProperty("created_at");
    expect(updated.name).toBe("改过的名字");
  });

  it("列表会同时问列表与总数两个端点", async () => {
    await store.init();
    await store.publish(SAMPLE);
    transport.requests.length = 0;

    const result = await store.list();

    const paths = transport.requests.map((r) => r.path).sort();
    expect(paths).toEqual([ENDPOINT_COUNT, ENDPOINT_LIST].sort());
    expect(result.total).toBe(1);
    expect(result.apps[0].name).toBe("番茄钟");
  });

  it("列表参数按 limit 与 offset 传过去", async () => {
    await store.init();
    transport.requests.length = 0;

    await store.list({ limit: 10, offset: 20 });

    const list = transport.requests.find((r) => r.path === ENDPOINT_LIST);
    expect(list?.query?.limit).toBe(10);
    expect(list?.query?.offset).toBe(20);
  });

  it("limit 被夹在合理范围内", async () => {
    await store.init();
    transport.requests.length = 0;

    await store.list({ limit: 999999 });

    const list = transport.requests.find((r) => r.path === ENDPOINT_LIST);
    expect(list?.query?.limit).toBe(200);
  });

  it("关键词传的是转义后的原文，百分号包在服务端做", async () => {
    await store.init();
    transport.requests.length = 0;

    await store.list({ keyword: "50%" });

    const list = transport.requests.find((r) => r.path === ENDPOINT_LIST);
    expect(list?.query?.keyword).toBe("50\\%");
  });

  it("关键词能按名称 / 简介 / 标签 / 作者匹配", async () => {
    await store.init();
    await store.publish(SAMPLE);
    await store.publish({
      ...SAMPLE,
      name: "别的应用",
      description: "完全不相干的简介",
      tags: "游戏",
    });

    expect((await store.list({ keyword: "番茄" })).total).toBe(1);
    expect((await store.list({ keyword: "计时" })).total).toBe(1);
    expect((await store.list({ keyword: "someone" })).total).toBe(2);
    expect((await store.list({ keyword: "不存在的词" })).total).toBe(0);
  });

  it("列表按更新时间倒序 —— 刚发布的排前面", async () => {
    await store.init();
    await store.publish({ ...SAMPLE, name: "第一个" });
    await new Promise((r) => setTimeout(r, 5));
    await store.publish({ ...SAMPLE, name: "第二个" });

    const result = await store.list();
    expect(result.apps.map((a) => a.name)).toEqual(["第二个", "第一个"]);
  });

  it("通配符不会被当成模式 —— 服务端按字面量匹配", async () => {
    await store.init();
    await store.publish(SAMPLE);

    const result = await store.list({ keyword: "%" });
    expect(result.total).toBe(0);
  });

  it("按 id 能取回同一条", async () => {
    await store.init();
    const published = await store.publish(SAMPLE);

    const fetched = await store.get(published.id);
    expect(fetched?.name).toBe("番茄钟");
    expect(fetched?.manifest).toBe(SAMPLE.manifest);
  });

  it("取不存在的 id 返回 null", async () => {
    await store.init();
    expect(await store.get("app_不存在")).toBeNull();
  });

  it("被获取次数会累加", async () => {
    await store.init();
    const published = await store.publish(SAMPLE);
    transport.requests.length = 0;

    await store.incrementPulls(published.id);
    await store.incrementPulls(published.id);

    const mark = transport.requests.find((r) => r.path === ENDPOINT_MARK_PULLED);
    expect(mark?.body?.id).toBe(published.id);
    expect((await store.get(published.id))?.pulls).toBe(2);
  });

  it("删除之后取不到了", async () => {
    await store.init();
    const published = await store.publish(SAMPLE);
    transport.requests.length = 0;

    expect(await store.remove(published.id)).toBe(true);
    const remove = transport.requests.find((r) => r.path === ENDPOINT_REMOVE);
    expect(remove?.body?.id).toBe(published.id);
    expect(await store.get(published.id)).toBeNull();
    expect((await store.list()).total).toBe(0);
  });

  it("删除不存在的条目返回 false", async () => {
    await store.init();
    expect(await store.remove("app_不存在")).toBe(false);
  });

  it("覆盖发布保留 id、创建时间与被获取次数", async () => {
    await store.init();
    const published = await store.publish(SAMPLE);
    await store.incrementPulls(published.id);

    const updated = await store.publish(
      { ...SAMPLE, name: "改过的名字" },
      published.id
    );

    expect(updated.id).toBe(published.id);
    expect(updated.name).toBe("改过的名字");
    expect(updated.createdAt).toBe(published.createdAt);
    expect(updated.pulls).toBe(1);
  });

  it("check 通的时候给出目录里有多少个应用", async () => {
    await store.init();
    await store.publish(SAMPLE);

    const result = await store.check();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("1");
  });

  it("check 不通时给出原因", async () => {
    const broken = new CatalogSharedStore({
      request: async () => {
        throw new CatalogError("auth failed", 401);
      },
    });

    const result = await broken.check();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("auth failed");
  });
});

describe("版本与依赖", () => {
  it("发布时把版本与依赖一起发过去，读回来一致", async () => {
    const transport = new FakeCatalogTransport();
    const store = new CatalogSharedStore(transport);
    await store.init();
    transport.requests.length = 0;

    const published = await store.publish({
      ...SAMPLE,
      version: "1.2.3",
      dependencies: [{ id: "a.b" }, { id: "c.d", range: "^2.0.0" }],
    });

    const publish = transport.requests.find((r) => r.path === ENDPOINT_PUBLISH);
    expect(publish?.body?.version).toBe("1.2.3");
    expect(publish?.body?.dependencies).toBe(
      '[{"id":"a.b"},{"id":"c.d","range":"^2.0.0"}]'
    );

    expect(published.version).toBe("1.2.3");
    expect(published.dependencies).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "^2.0.0" },
    ]);

    const fetched = await store.get(published.id);
    expect(fetched?.version).toBe("1.2.3");
    expect(fetched?.dependencies).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "^2.0.0" },
    ]);
  });

  it("端点不认版本列时退回 —— 标成没存上", async () => {
    const requests: CatalogRequest[] = [];
    const table: Array<Record<string, unknown>> = [];
    const store = new CatalogSharedStore({
      request: async (req: CatalogRequest) => {
        requests.push(req);
        if (req.path === ENDPOINT_PUBLISH) {
          if ("version" in (req.body ?? {})) {
            throw new CatalogError("Unknown column 'version' in 'field list'", 400);
          }
          table.push({ ...req.body });
          return ok([]);
        }
        if (req.path === ENDPOINT_GET) {
          const row = table.find((item) => item.id === req.query?.id);
          return ok(row ? [{ ...row }] : []);
        }
        return ok([]);
      },
    });

    const published = await store.publish({ ...SAMPLE, version: "1.2.3" });

    expect(published.versionDropped).toBe(true);
    expect(published.version).toBeUndefined();
    const publishes = requests.filter((r) => r.path === ENDPOINT_PUBLISH);
    expect(publishes).toHaveLength(2);
    expect(publishes[0].body).toHaveProperty("version");
    expect(publishes[1].body).not.toHaveProperty("version");
  });

  it("端点不认依赖列时退回 —— 标成没存上", async () => {
    const requests: CatalogRequest[] = [];
    const table: Array<Record<string, unknown>> = [];
    const store = new CatalogSharedStore({
      request: async (req: CatalogRequest) => {
        requests.push(req);
        if (req.path === ENDPOINT_PUBLISH) {
          if ("dependencies" in (req.body ?? {})) {
            throw new CatalogError("Unknown column 'dependencies'", 400);
          }
          table.push({ ...req.body });
          return ok([]);
        }
        if (req.path === ENDPOINT_GET) {
          const row = table.find((item) => item.id === req.query?.id);
          return ok(row ? [{ ...row }] : []);
        }
        return ok([]);
      },
    });

    const published = await store.publish({
      ...SAMPLE,
      dependencies: [{ id: "a.b" }],
    });

    expect(published.dependenciesDropped).toBe(true);
    expect(published.dependencies).toEqual([]);
    const publishes = requests.filter((r) => r.path === ENDPOINT_PUBLISH);
    expect(publishes).toHaveLength(2);
    expect(publishes[0].body).toHaveProperty("dependencies");
    expect(publishes[1].body).not.toHaveProperty("dependencies");
  });

  it("端点不认资源列时退回 —— 标成没存上", async () => {
    const requests: CatalogRequest[] = [];
    const table: Array<Record<string, unknown>> = [];
    const store = new CatalogSharedStore({
      request: async (req: CatalogRequest) => {
        requests.push(req);
        if (req.path === ENDPOINT_PUBLISH) {
          if ("bundle" in (req.body ?? {})) {
            throw new CatalogError("Unknown column 'bundle'", 400);
          }
          table.push({ ...req.body });
          return ok([]);
        }
        if (req.path === ENDPOINT_GET) {
          const row = table.find((item) => item.id === req.query?.id);
          return ok(row ? [{ ...row }] : []);
        }
        return ok([]);
      },
    });

    const published = await store.publish({ ...SAMPLE, bundle: "Ym9ndW5sZQ==" });

    expect(published.bundleDropped).toBe(true);
    const publishes = requests.filter((r) => r.path === ENDPOINT_PUBLISH);
    expect(publishes[0].body).toHaveProperty("bundle");
    expect(publishes[1].body).not.toHaveProperty("bundle");
  });
});
