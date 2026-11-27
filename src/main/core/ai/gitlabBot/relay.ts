import { randomBytes, timingSafeEqual } from "node:crypto";
import { getGitlabBotConfig } from "./configStore";

export const RELAY_TOKEN_PREFIX = "qnrelay_";
export const RELAY_TOKEN_HEADER = "x-qnote-relay-token";
export const RELAY_PIPELINE_ID_HEADER = "x-qnote-pipeline-id";
export const RELAY_PROJECT_ID_HEADER = "x-qnote-project-id";

export function generateRelayToken(): string {
  return `${RELAY_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export interface RelayRequest {
  token: string;
  eventType: string;
  payload: unknown;
  projectId?: number;
  pipelineId?: number;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authorizeRelay(token: string): { ok: boolean; reason: string } {
  const config = getGitlabBotConfig();
  if (!config.relayToken) {
    return { ok: false, reason: "没配 relay 令牌" };
  }
  if (!token) {
    return { ok: false, reason: "缺 relay 令牌" };
  }
  if (!safeEqual(token, config.relayToken)) {
    return { ok: false, reason: "relay 令牌不匹配" };
  }
  return { ok: true, reason: "relay 令牌校验通过" };
}

function readId(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function parseRelayRequest(options: {
  token: string;
  eventType: string;
  payload: unknown;
  projectId?: unknown;
  pipelineId?: unknown;
}): RelayRequest {
  const projectId = readId(options.projectId);
  const pipelineId = readId(options.pipelineId);
  return {
    token: options.token,
    eventType: options.eventType,
    payload: options.payload,
    ...(projectId ? { projectId } : {}),
    ...(pipelineId ? { pipelineId } : {}),
  };
}
