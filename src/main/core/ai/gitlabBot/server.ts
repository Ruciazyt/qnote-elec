import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { log } from "../../system/log";
import { getGitlabBotConfig } from "./configStore";
import { verifyWebhookSignature } from "./signature";
import {
  authorizeRelay,
  parseRelayRequest,
  RELAY_PIPELINE_ID_HEADER,
  RELAY_PROJECT_ID_HEADER,
  RELAY_TOKEN_HEADER,
} from "./relay";
import { parseGitlabEvent } from "./webhook";
import { loadTriggerPayload } from "./triggerPayload";
import { resolveEventPayload } from "./eventHydrator";
import type { GitlabBotTrigger } from "./trigger";

export const GITLAB_WEBHOOK_PATH = "/gitlab/webhook";
export const GITLAB_HEALTH_PATH = "/gitlab/health";
export const GITLAB_RELAY_PATH = "/gitlab/relay";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
      void this.handle(req, res);
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
      server.listen(config.port, config.bindAddress);
    });

    const address = server.address();
    this.port = typeof address === "object" && address ? address.port : config.port;
    this.server = server;
    return {
      port: this.port,
      url: `http://${config.bindAddress}:${this.port}`,
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

    if (pathname !== GITLAB_WEBHOOK_PATH || req.method !== "POST") {
      this.sendJson(res, 404, { error: "not found" });
      return;
    }

    const rawBody = await readRawBody(req);
    const auth = this.authorize(req, rawBody);
    if (!auth.ok) {
      log.warn("[gitlab-bot] webhook 鉴权失败", { reason: auth.reason });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    let payload: any;
    try {
      payload = parseJsonBody(rawBody);
    } catch (err) {
      this.sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const eventType = String(req.headers["x-gitlab-event"] || "");
    const outcome = await this.trigger.handle(eventType, payload);
    this.sendJson(res, 200, outcome);
  }

  private async handleRelay(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
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
      token: String(req.headers[RELAY_TOKEN_HEADER] || ""),
      eventType: String(req.headers["x-gitlab-event"] || ""),
      payload,
      projectId: req.headers[RELAY_PROJECT_ID_HEADER],
      pipelineId: req.headers[RELAY_PIPELINE_ID_HEADER],
    });

    const auth = authorizeRelay(request.token);
    if (!auth.ok) {
      log.warn("[gitlab-bot] relay 鉴权失败", { reason: auth.reason });
      this.sendJson(res, 401, { error: "unauthorized" });
      return;
    }

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

    const hydrated = await resolveEventPayload(resolved.payload);
    if (!hydrated.ok) {
      log.warn("[gitlab-bot] 回源取原文失败", { reason: hydrated.reason });
      this.sendJson(res, 502, {
        error: hydrated.reason ?? "回源取原文失败",
      });
      return;
    }
    resolved = { ...resolved, payload: hydrated.payload };

    const event = parseGitlabEvent(resolved.eventType, resolved.payload);
    if (!event) {
      this.sendJson(res, 400, { error: "转发报文解析失败" });
      return;
    }

    const result = this.trigger.enqueue(event);
    if (!result.accepted) {
      log.info("[gitlab-bot] relay 事件未入队", { reason: result.reason });
    }
    this.sendJson(res, 200, {
      accepted: result.accepted,
      queued: result.accepted,
      reason: result.reason,
    });
  }

  private authorize(
    req: http.IncomingMessage,
    rawBody: Buffer
  ): { ok: boolean; reason: string } {
    const config = getGitlabBotConfig();
    if (config.signingToken) {
      return verifyWebhookSignature({
        signingToken: config.signingToken,
        messageId: String(req.headers["webhook-id"] || ""),
        timestamp: String(req.headers["webhook-timestamp"] || ""),
        signatureHeader: String(req.headers["webhook-signature"] || ""),
        rawBody,
      });
    }
    if (config.secretToken) {
      const token = String(req.headers["x-gitlab-token"] || "");
      if (!safeEqual(token, config.secretToken)) {
        return { ok: false, reason: "X-Gitlab-Token 不匹配" };
      }
      return { ok: true, reason: "明文令牌校验通过" };
    }
    return { ok: false, reason: "没配 webhook 密钥" };
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
