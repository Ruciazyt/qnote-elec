// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../../system/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { PluginRpcServer } from "./rpcServer";
import type { PluginManifest } from "../../../../shared/plugin/manifest/pluginTypes";

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
let pluginServer: http.Server;
let pluginPort = 0;
let lastCall: { method: string; params: Record<string, unknown> } | null = null;
let pluginHandler: (
  payload: { method: string; params?: Record<string, unknown> }
) => unknown = (payload) =>
  payload.method ? { ok: true } : { ok: false };

beforeEach(async () => {
  server = new PluginRpcServer({
    handlePluginCall: async () => ({ ok: true }),
    onPluginEvent: () => undefined,
  });
  await server.ensureStarted();
  token = server.createSession(PLUGIN_ID, MANIFEST).token;

  lastCall = null;
  pluginHandler = (payload) => {
    lastCall = { method: payload.method, params: payload.params ?? {} };
    return { ok: true };
  };
  pluginServer = http.createServer((req, res) => {
    if (req.headers["x-qnote-token"] !== token) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const payload = JSON.parse(
        Buffer.concat(chunks).toString("utf-8")
      ) as { id?: number; method: string; params?: Record<string, unknown> };
      Promise.resolve()
        .then(() => pluginHandler(payload))
        .then(
        (result) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id ?? null,
              result: result ?? null,
            })
          );
        },
        (err: unknown) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id ?? null,
              error: {
                code: -32003,
                message: String(
                  err instanceof Error ? err.message : err
                ),
              },
            })
          );
        }
      );
    });
  });
  await new Promise<void>((resolve) => {
    pluginServer.listen(0, "127.0.0.1", () => {
      pluginPort = (pluginServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterEach(async () => {
  await server.dispose();
  await new Promise<void>((resolve) => {
    pluginServer.close(() => resolve());
  });
});

function register(port = pluginPort, useToken = token): Promise<Response> {
  return fetch(`${server.endpoint}/register-callback`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-qnote-token": useToken },
    body: JSON.stringify({ port }),
  });
}

describe("PluginRpcServer", () => {
  it("插件注册回调地址后，宿主能调到插件的方法", async () => {
    expect((await register()).status).toBe(200);

    const result = await server.callPlugin(
      PLUGIN_ID,
      "plugin.activate",
      { hello: 1 },
      5000
    );

    expect(result).toEqual({ ok: true });
    expect(lastCall?.method).toBe("plugin.activate");
    expect(lastCall?.params).toEqual({ hello: 1 });
  });

  it("插件没注册回调地址时调用直接失败", async () => {
    await expect(
      server.callPlugin(PLUGIN_ID, "plugin.activate", {}, 1000)
    ).rejects.toThrow(/没有注册回调地址/);
  });

  it("令牌不对时注册被拒", async () => {
    const res = await register(pluginPort, "wrong-token");
    expect(res.status).toBe(401);
    expect(server.isConnected(PLUGIN_ID)).toBe(false);
  });

  it("端口不合法时注册被拒", async () => {
    const res = await register(0);
    expect(res.status).toBe(400);
    expect(server.isConnected(PLUGIN_ID)).toBe(false);
  });

  it("等回调注册：注册之后立刻返回", async () => {
    const waiting = server.waitForCallback(PLUGIN_ID, 5000);
    await register();
    await expect(waiting).resolves.toBe(true);
    expect(server.isConnected(PLUGIN_ID)).toBe(true);
  });

  it("等回调注册：插件不注册就等到超时", async () => {
    await expect(
      server.waitForCallback(PLUGIN_ID, 300)
    ).resolves.toBe(false);
  });

  it("插件回错误时宿主把错误抛出来", async () => {
    await register();
    pluginHandler = () => {
      throw new Error("命令没注册");
    };
    await expect(
      server.callPlugin(PLUGIN_ID, "qnote.command.invoke", {}, 5000)
    ).rejects.toThrow("命令没注册");
  });

  it("插件断开时未兑现的调用立刻失败", async () => {
    await register();
    pluginHandler = () => new Promise(() => undefined);
    const call = server.callPlugin(PLUGIN_ID, "plugin.activate", {}, 10000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.destroySession(PLUGIN_ID);
    await expect(call).rejects.toThrow(/已断开/);
  });
});
