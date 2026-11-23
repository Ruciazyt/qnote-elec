// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return { handlers, publishApp: vi.fn() };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, ...args: unknown[]) => unknown
    ) => {
      h.handlers.set(channel, fn);
    },
  },
}));

vi.mock("../../core/system/log", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../../database/cloud/cloudManager", () => ({
  checkCatalog: vi.fn(async () => ({ ok: true })),
  describeCloudError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  getApp: vi.fn(async () => null),
  getConfig: vi.fn(async () => ({ backend: "local", catalog: null, lastCheck: null })),
  listApps: vi.fn(async () => ({ apps: [], total: 0 })),
  markPulled: vi.fn(async () => undefined),
  publishApp: h.publishApp,
  removeApp: vi.fn(async () => true),
  switchBackend: vi.fn(async () => ({
    ok: true,
    config: { backend: "local", catalog: null, lastCheck: null },
  })),
  updateConfig: vi.fn(async () => ({
    ok: true,
    config: { backend: "local", catalog: null, lastCheck: null },
  })),
}));

vi.mock("../../../database/cloud/defaults", () => ({
  resolveDefaultCatalogConfig: () => null,
  sanitizeCatalogConfig: (config: unknown) => config ?? null,
}));

import { registerCloudHandlers } from "./cloudHandlers";

function invoke(channel: string, ...args: unknown[]): unknown {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`没有注册 ${channel}`);
  return fn({}, ...args);
}

function manifestOf(runtime: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "local.demo",
    name: "示例",
    version: "1.2.3",
    publisher: "local",
    engines: { qnote: "^2.0.0" },
    runtime,
    ...extra,
  });
}

describe("发布应用的 IPC", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.publishApp.mockReset();
    h.publishApp.mockImplementation(async (input: unknown) => ({
      id: "app_1",
      ...(input as Record<string, unknown>),
      name: (input as Record<string, unknown>).name,
      description: "",
      author: "",
      manifest: "",
      repoUrl: "",
      tags: "",
      pulls: 0,
      createdAt: 0,
      updatedAt: 0,
    }));
    registerCloudHandlers();
  });

  it("清单里有 IP 字面量 —— 发布被拦下", async () => {
    const res = await invoke(
      "cloud:publish-app",
      {
        name: "示例",
        // eslint-disable-next-line sonarjs/no-clear-text-protocols -- 用例就是要断言带 IP 的地址被拦下
        manifest: manifestOf({ preview: { type: "url", url: "http://127.0.0.1:7799/" } }), // NOSONAR
      }
    );

    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("127.0.0.1");
    expect(h.publishApp).not.toHaveBeenCalled();
  });

  it("env 里有 IP 字面量 —— 发布被拦下", async () => {
    const res = await invoke(
      "cloud:publish-app",
      {
        name: "示例",
        // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言带 IP 的环境变量被拦下
        manifest: manifestOf({ command: "node server.mjs", env: { API: "http://10.0.0.1" } }), // NOSONAR
      }
    );

    expect(res).toMatchObject({ ok: false });
    expect(h.publishApp).not.toHaveBeenCalled();
  });

  it("网络能力里有 IP 字面量 —— 发布被拦下", async () => {
    const res = await invoke(
      "cloud:publish-app",
      {
        name: "示例",
        manifest: manifestOf(
          { command: "node server.mjs" },
          // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言网络能力里的 IP 被拦下
          { capabilities: { network: ["http://192.168.1.10/*"] } } // NOSONAR
        ),
      }
    );

    expect(res).toMatchObject({ ok: false });
    expect(h.publishApp).not.toHaveBeenCalled();
  });

  it("清单干净 —— 照常发布", async () => {
    const res = await invoke(
      "cloud:publish-app",
      { name: "示例", manifest: manifestOf({ preview: { type: "port", port: 7799 } }) }
    );

    expect(res).toMatchObject({ ok: true });
    expect(h.publishApp).toHaveBeenCalledTimes(1);
  });

  it("发布时把清单里的版本与依赖带上", async () => {
    await invoke(
      "cloud:publish-app",
      {
        name: "示例",
        manifest: manifestOf(
          { command: "node server.mjs" },
          { extensionDependencies: ["a.b", "c.d@^2.0.0"] }
        ),
      }
    );

    const input = h.publishApp.mock.calls[0][0] as Record<string, unknown>;
    expect(input.version).toBe("1.2.3");
    expect(input.dependencies).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "^2.0.0" },
    ]);
  });

  it("清单内容为空 —— 不发布", async () => {
    const res = await invoke("cloud:publish-app", { name: "示例", manifest: "  " });
    expect(res).toEqual({ ok: false, error: "清单内容不能为空" });
    expect(h.publishApp).not.toHaveBeenCalled();
  });
});
