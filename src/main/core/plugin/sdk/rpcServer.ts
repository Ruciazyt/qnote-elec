import * as http from "node:http";
import { randomBytes } from "node:crypto";
import { log } from "../../system/log";
import {
  RPC_ERROR,
  isRpcRequest,
  type RpcResponse,
} from "../../../../shared/plugin/sdk/protocol";
import type { PluginManifest } from "../../../../shared/plugin/manifest/pluginTypes";

const MAX_BODY_BYTES = 1024 * 1024;
const CALLBACK_PATH = "/host-call";

export interface RpcSession {
  pluginId: string;
  token: string;
  manifest: PluginManifest;
  createdAt: number;
  connected: boolean;
  callbackUrl: string | null;
}

export interface PluginRpcHost {
  handlePluginCall(
    session: RpcSession,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown>;
  onPluginEvent(
    pluginId: string,
    event: { level: string; message: string }
  ): void;
}

export class PluginRpcServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly byToken = new Map<string, RpcSession>();
  private readonly byPluginId = new Map<string, RpcSession>();
  private readonly readyWaiters = new Map<string, Array<() => void>>();
  private readonly pending = new Map<string, Set<AbortController>>();

  constructor(private readonly host: PluginRpcHost) {}

  get endpoint(): string {
    return this.port ? `http://127.0.0.1:${this.port}` : "";
  }

  async ensureStarted(): Promise<void> {
    if (this.server) return;
    await new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        this.port = typeof address === "object" && address ? address.port : 0;
        this.server = server;
        log.info("[plugin] RPC 服务已启动", { port: this.port });
        resolve();
      });
    });
  }

  createSession(pluginId: string, manifest: PluginManifest): RpcSession {
    const session: RpcSession = {
      pluginId,
      token: randomBytes(24).toString("hex"),
      manifest,
      createdAt: Date.now(),
      connected: false,
      callbackUrl: null,
    };
    this.byToken.set(session.token, session);
    this.byPluginId.set(pluginId, session);
    return session;
  }

  destroySession(pluginId: string): void {
    const session = this.byPluginId.get(pluginId);
    if (!session) return;
    this.byToken.delete(session.token);
    this.byPluginId.delete(pluginId);

    for (const controller of this.pending.get(pluginId) ?? []) {
      controller.abort();
    }
    this.pending.delete(pluginId);

    const waiters = this.readyWaiters.get(pluginId) ?? [];
    this.readyWaiters.delete(pluginId);
    for (const waiter of waiters) {
      waiter();
    }
  }

  hasSession(pluginId: string): boolean {
    return this.byPluginId.has(pluginId);
  }

  isConnected(pluginId: string): boolean {
    return this.byPluginId.get(pluginId)?.connected === true;
  }

  async waitForCallback(pluginId: string, timeoutMs: number): Promise<boolean> {
    const session = this.byPluginId.get(pluginId);
    if (!session) return false;
    if (session.connected) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const drop = (): void => {
        const current = this.readyWaiters.get(pluginId) ?? [];
        this.readyWaiters.set(
          pluginId,
          current.filter((item) => item !== onReady)
        );
      };
      const onReady = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        drop();
        resolve(this.isConnected(pluginId));
      };
      const list = this.readyWaiters.get(pluginId) ?? [];
      list.push(onReady);
      this.readyWaiters.set(pluginId, list);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        drop();
        resolve(false);
      }, timeoutMs);
    });
  }

  async callPlugin(
    pluginId: string,
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10000
  ): Promise<unknown> {
    const session = this.byPluginId.get(pluginId);
    if (!session?.callbackUrl) {
      throw new Error(`插件 ${pluginId} 没有注册回调地址`);
    }

    const controller = new AbortController();
    const controllers = this.pending.get(pluginId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.pending.set(pluginId, controllers);

    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(session.callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-qnote-token": session.token,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: controller.signal,
      });
      const payload = (await res.json()) as RpcResponse;
      if ("error" in payload) {
        throw new Error(payload.error.message);
      }
      return payload.result;
    } catch (err) {
      if (controller.signal.aborted) {
        if (!this.byPluginId.has(pluginId)) {
          throw new Error(`插件 ${pluginId} 已断开`);
        }
        throw new Error(`插件 ${pluginId} 没有回应 ${method}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  async dispose(): Promise<void> {
    for (const pluginId of [...this.byPluginId.keys()]) {
      this.destroySession(pluginId);
    }
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = url.searchParams.get("token") ?? headerToken(req);

      if (url.pathname === "/register-callback" && req.method === "POST") {
        await this.handleRegister(token, req, res);
        return;
      }

      if (url.pathname === "/rpc" && req.method === "POST") {
        await this.handleRpc(token, req, res);
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
      log.error("[plugin] RPC 请求处理失败:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "internal" }));
    }
  }

  private async handleRegister(
    token: string | null,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const session = token ? this.byToken.get(token) : undefined;
    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    let port = 0;
    try {
      const parsed = JSON.parse(await readBody(req)) as { port?: unknown };
      port = Number(parsed.port);
    } catch {
      port = 0;
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad port" }));
      return;
    }

    session.callbackUrl = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    session.connected = true;

    const waiters = this.readyWaiters.get(session.pluginId) ?? [];
    this.readyWaiters.delete(session.pluginId);
    for (const waiter of waiters) {
      waiter();
    }

    log.info("[plugin] 插件已注册回调地址", {
      pluginId: session.pluginId,
      port,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, port }));
  }

  private async handleRpc(
    token: string | null,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const session = token ? this.byToken.get(token) : undefined;
    if (!session) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: RPC_ERROR.unauthorized, message: "令牌不对" },
        })
      );
      return;
    }

    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: RPC_ERROR.parse, message: "请求体不是合法 JSON" },
        })
      );
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: RPC_ERROR.invalidRequest, message: "请求格式不对" },
        })
      );
      return;
    }

    const payload = parsed as Record<string, unknown>;
    if (!isRpcRequest(parsed)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: { code: RPC_ERROR.invalidRequest, message: "请求格式不对" },
        })
      );
      return;
    }

    try {
      const result = await this.host.handlePluginCall(
        session,
        parsed.method,
        parsed.params ?? {}
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id ?? null,
          result: result ?? null,
        } satisfies RpcResponse)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const rawCode = (err as { code?: unknown })?.code;
      const code = typeof rawCode === "number" ? rawCode : RPC_ERROR.internal;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id ?? null,
          error: { code, message },
        } satisfies RpcResponse)
      );
    }
  }
}

function headerToken(req: http.IncomingMessage): string | null {
  const raw = req.headers["x-qnote-token"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return null;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体太大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
