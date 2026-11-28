import * as http from "node:http";
import { log } from "../../../system/log";
import { getGitlabBotConfig } from "../config/configStore";
import {
  authorizeRelay,
  parseRelayRequest,
  RELAY_PIPELINE_ID_HEADER,
  RELAY_PROJECT_ID_HEADER,
  RELAY_TOKEN_HEADER,
} from "./relay";
import { loadTriggerPayload } from "../events/triggerPayload";
import type { GitlabBotTrigger } from "../events/trigger";
import { getGitlabEvent } from "../events/eventDetails";

export const GITLAB_HEALTH_PATH = "/gitlab/health";
export const GITLAB_RELAY_PATH = "/gitlab/relay";

export class GitlabBotServer {
  private server: http.Server | null = null;
  private port = 0;

  constructor(private readonly trigger: GitlabBotTrigger) {}

  get running(): boolean {
    return this.server !== null;
  }

  get currentPort(): number {
    return this.port;
  }

  async start(): Promise<{ port: number; url: string }> {
    const config = getGitlabBotConfig();
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        log.warn("[gitlab-bot] 处理请求失败", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          this.sendJson(res, 400, { error: "请求体不完整或已断开" });
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.port, "127.0.0.1");
    });

    const address = server.address();
    this.port = typeof address === "object" && address ? address.port : config.port;
    this.server = server;
    return {
      port: this.port,
      url: `http://127.0.0.1:${this.port}`,
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (!server) return;
    const closable = server as http.Server & { closeAllConnections?: () => void };
    try {
      closable.closeAllConnections?.();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    log.info("[gitlab-bot] 网关已停止");
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const pathname = (req.url || "").split("?")[0];

    if (pathname === GITLAB_HEALTH_PATH && req.method === "GET") {
      this.sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === GITLAB_RELAY_PATH && req.method === "POST") {
      await this.handleRelay(req, res);
      return;
    }

    this.sendJson(res, 404, { error: "not found" });
  }

  private async handleRelay(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const token = String(req.headers[RELAY_TOKEN_HEADER] || "");
    const auth = authorizeRelay(token);
    if (!auth.ok) {
      log.warn("[gitlab-bot] relay 鉴权失败", { reason: auth.reason });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const rawBody = await readRawBody(req);
    let payload: unknown;
    try {
      payload = parseJsonBody(rawBody);
    } catch (err) {
      this.sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const request = parseRelayRequest({
      token,
      eventType: String(req.headers["x-gitlab-event"] || ""),
      payload,
      projectId: req.headers[RELAY_PROJECT_ID_HEADER],
      pipelineId: req.headers[RELAY_PIPELINE_ID_HEADER],
    });

    let resolved = request;
    if (!payload) {
      if (!request.projectId || !request.pipelineId) {
        this.sendJson(res, 400, {
          error: "缺少报文：请带上报文，或带上 pipeline id 与项目 id",
        });
        return;
      }
      const fetched = await loadTriggerPayload({
        projectId: request.projectId,
        pipelineId: request.pipelineId,
      });
      if (!fetched.ok) {
        log.warn("[gitlab-bot] 取 trigger 报文失败", { reason: fetched.reason });
        this.sendJson(res, 400, { error: fetched.reason ?? "取 trigger 报文失败" });
        return;
      }
      resolved = { ...request, payload: fetched.payload };
    }

    const parsed = await getGitlabEvent(
      resolved.eventType,
      resolved.payload
    );
    if (parsed.ok === false && parsed.stage === "detail") {
      log.warn("[gitlab-bot] 回源取原文失败", { reason: parsed.reason });
      this.sendJson(res, 502, {
        error: parsed.reason,
      });
      return;
    }
    if (parsed.ok === false) {
      this.sendJson(res, 400, { error: parsed.reason });
      return;
    }
    const outcome = this.trigger.enqueue(parsed.event);
    if (!outcome.accepted) {
      log.info("[gitlab-bot] relay 事件未入队", { reason: outcome.reason });
    }
    this.sendJson(res, 200, {
      accepted: outcome.accepted,
      queued: outcome.accepted,
      reason: outcome.reason,
    });
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    body: unknown
  ): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }
}

async function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(rawBody: Buffer): unknown {
  const text = rawBody.toString("utf8");
  if (!text.trim()) return undefined;
  return JSON.parse(text);
}
