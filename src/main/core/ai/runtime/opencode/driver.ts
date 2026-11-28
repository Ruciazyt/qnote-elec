import type { OpencodeClient } from "./client";
import type {
  OpencodeAssistantResponse,
  OpencodeEventEnvelope,
  OpencodePart,
  OpencodePartInput,
  OpencodePromptOptions,
} from "./protocol";
import { normalizeToolOutput } from "./protocol";
import { log } from "../../../system/log";

export interface OpencodeToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface OpencodeToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

export interface OpencodeDriverHandlers {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolCall?: (call: OpencodeToolCall) => void;
  onToolResult?: (result: OpencodeToolResult) => void;
  onCompacted?: () => void;
}

export interface OpencodeDriverOptions {
  client: OpencodeClient;
  sessionID: string;
  agent?: string;
  signal?: AbortSignal;
  handlers?: OpencodeDriverHandlers;
  deadlineMs?: number;
  directory?: string;
}

export interface OpencodeDriverResult {
  text: string;
  thinking: string;
  toolCalls: OpencodeToolCall[];
  toolResults: OpencodeToolResult[];
  error?: string;
  aborted: boolean;
}

export const OPENCODE_DRIVER_DEADLINE_MS = 10 * 60 * 1000;

export class OpencodeDriver {
  constructor(private readonly options: OpencodeDriverOptions) {}

  async run(
    parts: OpencodePartInput[],
    extra: Partial<OpencodePromptOptions> = {}
  ): Promise<OpencodeDriverResult> {
    const { client, sessionID, signal, handlers } = this.options;
    const result: OpencodeDriverResult = {
      text: "",
      thinking: "",
      toolCalls: [],
      toolResults: [],
      aborted: false,
    };

    const partTypes = new Map<string, string>();
    const emittedText = new Map<string, string>();
    const settled = new Set<string>();
    const userMessageIDs = new Set<string>();

    const emitText = (partID: string, type: string, text: string): void => {
      if (!text) return;
      const previous = emittedText.get(partID) ?? "";
      let delta = "";
      if (text.startsWith(previous)) {
        delta = text.slice(previous.length);
      } else if (!previous.includes(text)) {
        delta = text;
      }
      if (!delta) return;
      emittedText.set(partID, previous + delta);
      if (type === "reasoning") {
        result.thinking += delta;
        handlers?.onThinking?.(delta);
        return;
      }
      result.text += delta;
      handlers?.onText?.(delta);
    };

    const emitToolCall = (callID: string, name: string, args: Record<string, any>): void => {
      const existing = result.toolCalls.find((c) => c.id === callID);
      if (existing) {
        if (args && Object.keys(args).length > 0 && Object.keys(existing.args).length === 0) {
          existing.args = args;
          handlers?.onToolCall?.({ ...existing });
        }
        return;
      }
      const call: OpencodeToolCall = { id: callID, name, args };
      result.toolCalls.push(call);
      handlers?.onToolCall?.(call);
    };

    const emitToolResult = (
      callID: string,
      name: string,
      content: string,
      isError: boolean
    ): void => {
      if (settled.has(callID)) return;
      settled.add(callID);
      const toolResult: OpencodeToolResult = { id: callID, name, content, isError };
      result.toolResults.push(toolResult);
      handlers?.onToolResult?.(toolResult);
    };

    const controller = new AbortController();
    const onAbort = (): void => {
      result.aborted = true;
      controller.abort();
      void client.abortSession(sessionID).catch(() => undefined);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const handleEvent = (event: OpencodeEventEnvelope): void => {
      const properties = event.properties || {};
      const eventSessionID = readEventSessionId(properties);
      if (eventSessionID && eventSessionID !== sessionID) return;

      switch (event.type) {
        case "message.part.updated": {
          const part = properties.part;
          if (!part || (part.messageID && userMessageIDs.has(part.messageID))) return;
          partTypes.set(part.id, part.type);
          if (part.type === "text" || part.type === "reasoning") {
            emitText(part.id, part.type, part.text);
            return;
          }
          if (part.type !== "tool") return;

          const state = part.state;
          if (!state) return;
          const callID = part.callID || part.id;
          switch (state.status) {
            case "pending":
            case "running":
              emitToolCall(callID, part.tool, state.input ?? {});
              return;
            case "completed":
              emitToolResult(callID, part.tool, normalizeToolOutput(state.output), false);
              return;
            case "error":
              emitToolResult(callID, part.tool, state.error || "工具执行失败", true);
              return;
            default:
              return;
          }
        }
        case "message.part.delta": {
          if (properties.field !== undefined && properties.field !== "text") return;
          if (properties.messageID && userMessageIDs.has(properties.messageID)) return;
          if (!properties.partID) return;
          const partID = properties.partID;
          const previous = emittedText.get(partID) ?? "";
          emitText(
            partID,
            partTypes.get(partID) ?? "text",
            previous + (properties.delta ?? "")
          );
          return;
        }
        case "message.updated": {
          const info = properties.info;
          if (!info) return;
          if (info.role === "user") userMessageIDs.add(info.id);
          if (info.role === "assistant" && info.error) {
            result.error = extractErrorMessage(info.error);
          }
          return;
        }
        case "session.compacted":
          handlers?.onCompacted?.();
          return;
        case "session.error":
          result.error =
            extractErrorMessage(properties.error) ?? result.error ?? "opencode 会话出错";
          return;
      }
    };

    const subscription: Promise<void> = client
      .subscribeEvents(
        controller.signal,
        handleEvent,
        this.options.directory ? { directory: this.options.directory } : undefined
      )
      .catch((err: unknown) => {
        log.warn("[opencode] 事件订阅失败", err);
      });

    const deadlineMs = this.options.deadlineMs ?? OPENCODE_DRIVER_DEADLINE_MS;
    let response: OpencodeAssistantResponse | undefined;
    try {
      response = await withDeadline(
        client.sendMessage(
          sessionID,
          { ...extra, parts, agent: this.options.agent ?? extra.agent },
          controller.signal
        ),
        deadlineMs,
        "opencode 响应超时"
      );
      if (response?.info?.error && !result.error) {
        result.error = extractErrorMessage(response.info.error);
      }
    } catch (err) {
      if (!result.error) {
        result.error = err instanceof Error ? err.message : String(err);
      }
      if (err instanceof DeadlineError && !result.aborted) {
        void client.abortSession(sessionID).catch(() => undefined);
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
      await settleSubscription(subscription);
    }

    applyResponseParts(result, response, handlers);

    return result;
  }
}

async function settleSubscription(subscription: Promise<void>): Promise<void> {
  try {
    await subscription;
  } catch (err) {
    log.warn("[opencode] 事件流结束异常", err);
  }
}

function applyResponseParts(
  result: OpencodeDriverResult,
  response: OpencodeAssistantResponse | undefined,
  handlers: OpencodeDriverHandlers | undefined
): void {
  const parts = response?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return;

  if (!result.text) {
    const text = collectPartText(parts, "text");
    if (text) {
      result.text = text;
      handlers?.onText?.(text);
    }
  }

  if (!result.thinking) {
    const thinking = collectPartText(parts, "reasoning");
    if (thinking) {
      result.thinking = thinking;
      handlers?.onThinking?.(thinking);
    }
  }
}

function collectPartText(parts: OpencodePart[], type: "text" | "reasoning"): string {
  let out = "";
  for (const part of parts) {
    if (part.type !== type) continue;
    const text = (part as { text?: unknown }).text;
    if (typeof text === "string") out += text;
  }
  return out;
}

class DeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineError";
  }
}

function readEventSessionId(properties: Record<string, any>): string | undefined {
  return properties.sessionID ?? properties.part?.sessionID ?? properties.info?.sessionID;
}

function extractErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  const payload = error as Record<string, any>;
  return (
    payload.data?.message ??
    payload.message ??
    payload.name ??
    JSON.stringify(error)
  );
}

function withDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(message)), deadlineMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
