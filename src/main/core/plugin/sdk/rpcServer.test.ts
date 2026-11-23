// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../system/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { PluginRpcServer } from "./rpcServer";
import type { PluginManifest } from "../../../../shared/plugin/manifest/pluginTypes";
import type { RpcRequest } from "../../../../shared/plugin/sdk/protocol";

const MANIFEST: PluginManifest = {
  id: "demo.plugin",
  name: "演示插件",
  version: "0.1.0",
  publisher: "demo",
  engines: { qnote: "^2.0.0" },
  runtime: { command: "node", preview: { type: "port", port: 3000 } },
};

const PLUGIN_ID = "demo.plugin";

let server: PluginRpcServer;
let token: string;

beforeEach(async () => {
  server = new PluginRpcServer({
    handlePluginCall: async () => ({ ok: true }),
    onPluginEvent: () => undefined,
  });
  await server.ensureStarted();
  token = server.createSession(PLUGIN_ID, MANIFEST).token;
});

afterEach(async () => {
  await server.dispose();
});

function poll(): Promise<Response> {
  return fetch(`${server.endpoint}/poll?token=${encodeURIComponent(token)}`);
}

async function respond(id: number, result: unknown): Promise<void> {
  const res = await fetch(`${server.endpoint}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-qnote-token": token },
    body: JSON.stringify({ jsonrpc: "2.0", id, result }),
  });
  expect(res.status).toBe(200);
}

describe("PluginRpcServer", () => {
  it("插件没在轮询时连续两次调用都进队列，先来的请求不被覆盖", async () => {
    const first = server.callPlugin(PLUGIN_ID, "plugin.activate", {}, 5000);
    const second = server.callPlugin(
      PLUGIN_ID,
      "qnote.command.invoke",
      { command: "demo.run" },
      5000
    );

    const res1 = await poll();
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as RpcRequest;
    expect(body1.method).toBe("plugin.activate");

    const res2 = await poll();
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as RpcRequest;
    expect(body2.method).toBe("qnote.command.invoke");
    expect(body2.id).not.toBe(body1.id);

    await respond(body1.id, { activated: true });
    await respond(body2.id, { invoked: true });

    await expect(first).resolves.toEqual({ activated: true });
    await expect(second).resolves.toEqual({ invoked: true });
  });

  it("插件挂在轮询上时调用立刻送达", async () => {
    const pending = poll();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const call = server.callPlugin(PLUGIN_ID, "plugin.activate", {}, 5000);

    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as RpcRequest;
    expect(body.method).toBe("plugin.activate");

    await respond(body.id, { ok: true });
    await expect(call).resolves.toEqual({ ok: true });
  });

  it("令牌不对一律拒绝", async () => {
    const res = await fetch(`${server.endpoint}/poll?token=wrong`);
    expect(res.status).toBe(401);
  });

  it("插件断开时未兑现的调用立刻失败", async () => {
    const call = server.callPlugin(PLUGIN_ID, "plugin.activate", {}, 5000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.destroySession(PLUGIN_ID);
    await expect(call).rejects.toThrow(/已断开/);
  });
});
