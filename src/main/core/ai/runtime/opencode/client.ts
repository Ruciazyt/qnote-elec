import fetch from "node-fetch";
import { log } from "../../../system/log";
import { SseParser } from "./sse";
import {
  OPENCODE_EVENT_PATH,
  OPENCODE_HEALTH_PATH,
  type OpencodeAssistantResponse,
  type OpencodeCreateSessionOptions,
  type OpencodeCredentials,
  type OpencodeEventEnvelope,
  type OpencodeHealth,
  type OpencodeMessageWithParts,
  type OpencodePermissionReply,
  type OpencodePermissionRequest,
  type OpencodePromptOptions,
  type OpencodeSession,
} from "./protocol";

export class OpencodeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string
  ) {
    super(message);
    this.name = "OpencodeRequestError";
  }
}

export type OpencodeFetch = typeof fetch;

export interface OpencodeClientOptions {
  baseUrl: string;
  credentials?: OpencodeCredentials;
  fetchImpl?: OpencodeFetch;
}

export class OpencodeClient {
  constructor(private readonly options: OpencodeClientOptions) {}

  private get baseUrl(): string {
    let url = this.options.baseUrl;
    while (url.endsWith("/")) url = url.slice(0, -1);
    return url;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const credentials = this.options.credentials;
    if (credentials?.password) {
      const raw = `${credentials.username}:${credentials.password}`;
      headers.authorization = `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {}
  ): Promise<T> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(`${this.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: this.authHeaders(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal as any,
    } as any);

    const text = await response.text();
    if (!response.ok) {
      throw new OpencodeRequestError(
        `opencode ${init.method ?? "GET"} ${path} 失败：${response.status}`,
        response.status,
        text.slice(0, 500)
      );
    }
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  async health(): Promise<OpencodeHealth> {
    return this.request<OpencodeHealth>(OPENCODE_HEALTH_PATH);
  }

  async createSession(options: OpencodeCreateSessionOptions = {}): Promise<OpencodeSession> {
    const body: Record<string, any> = {};
    if (options.title) body.title = options.title;
    if (options.agent) body.agent = options.agent;
    if (options.model) {
      body.model = { id: options.model.modelID, providerID: options.model.providerID };
    }
    if (options.metadata) body.metadata = options.metadata;
    const query = options.directory
      ? `?directory=${encodeURIComponent(options.directory)}`
      : "";
    return this.request<OpencodeSession>(`/session${query}`, {
      method: "POST",
      body,
    });
  }

  async sendMessage(
    sessionID: string,
    options: OpencodePromptOptions,
    signal?: AbortSignal
  ): Promise<OpencodeAssistantResponse> {
    return this.request<OpencodeAssistantResponse>(
      `/session/${sessionID}/message`,
      { method: "POST", body: buildPromptBody(options), signal }
    );
  }

  async sendMessageAsync(
    sessionID: string,
    options: OpencodePromptOptions
  ): Promise<void> {
    await this.request<void>(`/session/${sessionID}/prompt_async`, {
      method: "POST",
      body: buildPromptBody(options),
    });
  }

  async abortSession(sessionID: string): Promise<boolean> {
    return this.request<boolean>(`/session/${sessionID}/abort`, { method: "POST" });
  }

  async summarizeSession(
    sessionID: string,
    providerID: string,
    modelID: string
  ): Promise<boolean> {
    return this.request<boolean>(`/session/${sessionID}/summarize`, {
      method: "POST",
      body: { providerID, modelID },
    });
  }

  async listMessages(sessionID: string): Promise<OpencodeMessageWithParts[]> {
    return this.request<OpencodeMessageWithParts[]>(`/session/${sessionID}/message`);
  }

  async listSessions(): Promise<OpencodeSession[]> {
    const result = await this.request<OpencodeSession[] | { sessions?: OpencodeSession[] }>(
      "/session"
    );
    if (Array.isArray(result)) return result;
    return result?.sessions ?? [];
  }

  async listPermissions(): Promise<OpencodePermissionRequest[]> {
    return this.request<OpencodePermissionRequest[]>("/permission");
  }

  async replyPermission(
    requestID: string,
    reply: OpencodePermissionReply,
    message?: string
  ): Promise<boolean> {
    const body: Record<string, any> = { reply };
    if (message) body.message = message;
    return this.request<boolean>(`/permission/${requestID}/reply`, {
      method: "POST",
      body,
    });
  }

  async subscribeEvents(
    signal: AbortSignal,
    onEvent: (event: OpencodeEventEnvelope) => void,
    query?: { directory?: string }
  ): Promise<void> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const url = this.baseUrl + OPENCODE_EVENT_PATH + buildEventQuery(query);
    const response = await doFetch(url, {
      method: "GET",
      headers: this.authHeaders(),
      signal: signal as any,
    } as any);

    if (!response.ok) {
      throw new OpencodeRequestError(
        `opencode 事件流失败：${response.status}`,
        response.status
      );
    }

    const body = response.body as unknown as NodeJS.ReadableStream | null;
    if (!body) throw new Error("opencode 事件流没有响应体");

    const parser = new SseParser();
    await new Promise<void>((resolve, reject) => {
      let aborted = false;
      const onData = (chunk: Buffer) => {
        for (const message of parser.push(chunk.toString("utf8"))) {
          const envelope = parseEventEnvelope(message.data);
          if (!envelope) continue;
          try {
            onEvent(envelope);
          } catch (err) {
            log.warn("[opencode] 事件处理抛错", err);
          }
        }
      };
      body.on("data", onData);
      body.on("end", () => resolve());
      body.on("error", (err) => {
        if (aborted || signal.aborted) {
          resolve();
          return;
        }
        reject(err);
      });
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          const destroyable = body as unknown as { destroy?: () => void };
          try {
            destroyable.destroy?.();
          } catch {
            // ignore
          }
          resolve();
        },
        { once: true }
      );
    });
  }
}

function buildEventQuery(query?: { directory?: string }): string {
  if (!query?.directory) return "";
  return "?directory=" + encodeURIComponent(query.directory);
}

function buildPromptBody(options: OpencodePromptOptions): Record<string, any> {
  const body: Record<string, any> = { parts: options.parts };
  if (options.system) body.system = options.system;
  if (options.model) {
    body.model = {
      providerID: options.model.providerID,
      modelID: options.model.modelID,
    };
  }
  if (options.agent) body.agent = options.agent;
  if (options.tools) body.tools = options.tools;
  if (options.messageID) body.messageID = options.messageID;
  return body;
}

function parseEventEnvelope(data: string): OpencodeEventEnvelope | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed.payload ?? parsed;
    if (typeof candidate.type !== "string") return null;
    return candidate as OpencodeEventEnvelope;
  } catch {
    return null;
  }
}
