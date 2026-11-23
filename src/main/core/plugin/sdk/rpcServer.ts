import * as http from "node:http";
import { randomBytes } from "node:crypto";
import { log } from "../../system/log";
import {
  RPC_ERROR,
  isRpcRequest,
  type RpcRequest,
  type RpcResponse,
} from "../../../../shared/plugin/sdk/protocol";
import type { PluginManifest } from "../../../../shared/plugin/manifest/pluginTypes";

const POLL_TIMEOUT_MS = 25000;
const MAX_BODY_BYTES = 1024 * 1024;

export interface RpcSession {
  pluginId: string;
  token: string;
  manifest: PluginManifest;
  createdAt: number;
  connected: boolean;
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

interface Waiter {
  resolve: (value: RpcRequest | null) => void;
  timer: NodeJS.Timeout;
}

interface PendingCall {
  pluginId: string;
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PluginRpcServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly byToken = new Map<string, RpcSession>();
  private readonly byPluginId = new Map<string, RpcSession>();
  private readonly queued = new Map<string, RpcRequest[]>();
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly pendingCalls = new Map<number, PendingCall>();
  private nextRequestId = 1;

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
    this.queued.delete(pluginId);

    for (const [id, call] of this.pendingCalls) {
      if (call.pluginId !== pluginId) continue;
      clearTimeout(call.timer);
      this.pendingCalls.delete(id);
      call.reject(new Error(`插件 ${pluginId} 已断开`));
    }

    const waiters = this.waiters.get(pluginId) ?? [];
    this.waiters.delete(pluginId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
  }

  hasSession(pluginId: string): boolean {
    return this.byPluginId.has(pluginId);
  }

  isConnected(pluginId: string): boolean {
    return this.byPluginId.get(pluginId)?.connected === true;
  }

  async callPlugin(
    pluginId: string,
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10000
  ): Promise<unknown> {
    if (!this.byPluginId.has(pluginId)) {
      throw new Error(`插件 ${pluginId} 没有连接 RPC 通道`);
    }

    const id = this.nextRequestId++;
    const request: RpcRequest = { jsonrpc: "2.0", id, method, params };

    const response = await new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`插件 ${pluginId} 没有回应 ${method}`));
      }, timeoutMs);
      this.pendingCalls.set(id, { pluginId, resolve, reject, timer });
      this.enqueue(pluginId, request);
    });

    if ("error" in response) {
      throw new Error(response.error.message);
    }
    return response.result;
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

  private enqueue(pluginId: string, request: RpcRequest): void {
    const waiters = this.waiters.get(pluginId) ?? [];
    const waiter = waiters.shift();
    if (waiter) {
      this.waiters.set(pluginId, waiters);
      clearTimeout(waiter.timer);
      waiter.resolve(request);
      return;
    }
    const list = this.queued.get(pluginId) ?? [];
    list.push(request);
    this.queued.set(pluginId, list);
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = url.searchParams.get("token") ?? headerToken(req);

      if (url.pathname === "/poll") {
        this.handlePoll(token, res);
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

  private handlePoll(token: string | null, res: http.ServerResponse): void {
    const session = token ? this.byToken.get(token) : undefined;
    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    session.connected = true;

    const queued = this.queued.get(session.pluginId);
    const next = queued?.shift();
    if (next) {
      if (queued && queued.length === 0) {
        this.queued.delete(session.pluginId);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(next));
      return;
    }

    const waiter: Waiter = {
      resolve: (request) => {
        if (res.writableEnded) return;
        if (request) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(request));
        } else {
          res.writeHead(204);
          res.end();
        }
      },
      timer: setTimeout(() => {
        const list = this.waiters.get(session.pluginId) ?? [];
        this.waiters.set(
          session.pluginId,
          list.filter((item) => item !== waiter)
        );
        if (!res.writableEnded) {
          res.writeHead(204);
          res.end();
        }
      }, POLL_TIMEOUT_MS),
    };

    const list = this.waiters.get(session.pluginId) ?? [];
    list.push(waiter);
    this.waiters.set(session.pluginId, list);

    res.on("close", () => {
      clearTimeout(waiter.timer);
      const current = this.waiters.get(session.pluginId) ?? [];
      this.waiters.set(
        session.pluginId,
        current.filter((item) => item !== waiter)
      );
    });
  }

  private async handleRpc(
    token: string | null,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const session = token ? this.byToken.get(token) : undefined;
    if (!session) {
      res.writeHead(401, { "content-type": "application/json" });
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
    const hasMethod = typeof payload.method === "string" && payload.method.length > 0;

    if (!hasMethod) {
      const id = Number(payload.id);
      const call = Number.isFinite(id) ? this.pendingCalls.get(id) : undefined;
      if (!call) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id ?? null,
            error: { code: RPC_ERROR.invalidRequest, message: "找不到对应的请求" },
          })
        );
        return;
      }
      clearTimeout(call.timer);
      this.pendingCalls.delete(id);
      const responseId = (payload.id ?? null) as string | number | null;
      const response: RpcResponse =
        payload.error && typeof payload.error === "object"
          ? {
              jsonrpc: "2.0",
              id: responseId,
              error: payload.error as { code: number; message: string },
            }
          : { jsonrpc: "2.0", id: responseId, result: payload.result ?? null };
      call.resolve(response);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id ?? null, result: true }));
      return;
    }

    if (!isRpcRequest(parsed)) {
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
