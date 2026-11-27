import fetch from "node-fetch";
import { log } from "../system/log";
import {
  AiConfig,
  AiMessage,
  AiProvider,
  AiUsage,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS,
  DEFAULT_TEMPERATURE,
  NormalizedProvider,
} from "./types";
import { AiApiError, AiConfigError } from "./errors";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export function resolveBaseUrl(
  baseUrl: string | undefined,
  provider: AiProvider
): string | undefined {
  const trimmed = (baseUrl || "").trim().replace(/^((?:[\s\S]*[^/])?)\/+$/, "$1");
  if (!trimmed) return undefined;

  if (provider === 'claude') {
    if (trimmed.endsWith('/v1/messages')) {
      return trimmed.slice(0, -'/v1/messages'.length);
    }
    if (trimmed.endsWith('/v1')) {
      return trimmed.slice(0, -'/v1'.length);
    }
    return trimmed;
  }

  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length);
  }
  if (/\/anthropic$/i.test(trimmed)) {
    return `${trimmed.slice(0, -'/anthropic'.length)}/v1`;
  }
  return trimmed;
}

export function normalizeProvider(provider: AiProvider): NormalizedProvider {
  return provider === 'claude' ? 'claude' : 'openai';
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const VALIDATE_REQUEST_TIMEOUT_MS = 20_000;
export const VALIDATE_MAX_RETRIES = 0;

export interface ChatRequestOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ChatCompletion {
  content: string;
  usage?: AiUsage;
  model?: string;
}

interface HttpFailure extends Error {
  status?: number;
}

export async function requestChatCompletion(
  config: AiConfig,
  messages: AiMessage[],
  maxTokens?: number,
  options?: ChatRequestOptions
): Promise<ChatCompletion> {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new AiConfigError('请先在设置中配置 AI API Key');
  }

  const normalized = normalizeProvider(config.provider);
  const model = config.model?.trim() || DEFAULT_MODELS[normalized];
  const limit =
    typeof maxTokens === 'number' && maxTokens > 0
      ? maxTokens
      : DEFAULT_MAX_TOKENS[normalized];
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? 2;

  log.info('requestChatCompletion', {
    provider: config.provider,
    normalizedProvider: normalized,
    model,
    maxTokens: limit,
    timeout: timeoutMs,
    maxRetries,
  });

  return withRetry(
    () =>
      normalized === 'claude'
        ? requestClaude(config, messages, model, limit, timeoutMs)
        : requestOpenAi(config, messages, model, limit, timeoutMs),
    maxRetries
  );
}

async function requestOpenAi(
  config: AiConfig,
  messages: AiMessage[],
  model: string,
  maxTokens: number,
  timeoutMs: number
): Promise<ChatCompletion> {
  const baseUrl = resolveBaseUrl(config.baseUrl, 'openai') || OPENAI_DEFAULT_BASE_URL;
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: DEFAULT_TEMPERATURE,
  };

  if (usesCompletionTokensParam(model)) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }

  const payload = await postJson(
    `${baseUrl}/chat/completions`,
    { authorization: `Bearer ${config.apiKey}` },
    body,
    timeoutMs
  );

  const choice = payload?.choices?.[0];
  return {
    content: extractText(choice?.message?.content),
    usage: normalizeUsage(payload?.usage),
    model: typeof payload?.model === 'string' ? payload.model : undefined,
  };
}

async function requestClaude(
  config: AiConfig,
  messages: AiMessage[],
  model: string,
  maxTokens: number,
  timeoutMs: number
): Promise<ChatCompletion> {
  const baseUrl = resolveBaseUrl(config.baseUrl, 'claude') || CLAUDE_DEFAULT_BASE_URL;
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const chat = messages.filter((m) => m.role !== 'system');

  if (chat.length === 0) {
    throw new AiConfigError('发给 Claude 的内容不能只有系统消息');
  }

  const body: Record<string, unknown> = {
    model,
    messages: chat.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
    temperature: DEFAULT_TEMPERATURE,
  };
  if (system) body.system = system;

  const payload = await postJson(
    `${baseUrl}/v1/messages`,
    {
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body,
    timeoutMs
  );

  const parts = Array.isArray(payload?.content) ? payload.content : [];
  return {
    content: parts
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join(''),
    usage: normalizeUsage(payload?.usage),
    model: typeof payload?.model === 'string' ? payload.model : undefined,
  };
}

function usesCompletionTokensParam(model: string): boolean {
  return /^(?:o\d|gpt-5)/i.test(model.trim());
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return '';
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal as any,
    });
    const text = await res.text();
    let payload: any;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!res.ok) {
      throw httpFailure(res.status, extractErrorMessage(payload, res.status));
    }
    return payload;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw httpFailure(undefined, `Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractErrorMessage(payload: any, status: number): string {
  const message = payload?.error?.message ?? payload?.message ?? payload?.raw;
  if (typeof message === 'string' && message.trim()) return message;
  return `HTTP ${status}`;
}

function httpFailure(status: number | undefined, message: string): HttpFailure {
  const err = new Error(message) as HttpFailure;
  if (status !== undefined) err.status = status;
  return err;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof AiConfigError) return false;
  const status = (err as HttpFailure)?.status;
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryable(err)) throw err;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

export function normalizeError(err: unknown, provider: AiProvider): never {
  if (err instanceof AiConfigError) {
    throw err;
  }

  const e = err as any;
  const status = e?.status ?? e?.response?.status as number | undefined;
  const message =
    e?.error?.message ??
    e?.message ??
    (typeof err === 'string' ? err : (JSON.stringify(err) ?? String(err)));

  log.error(`AI 调用失败 [${provider}]`, { status, message });
  throw new AiApiError(`AI 调用失败: ${message}`, status, provider);
}

export function normalizeUsage(usageMeta: any): AiUsage | undefined {
  if (!usageMeta) return undefined;
  const input = usageMeta.input_tokens ?? usageMeta.prompt_tokens ?? 0;
  const output = usageMeta.output_tokens ?? usageMeta.completion_tokens ?? 0;
  const total = usageMeta.total_tokens ?? input + output;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: total,
  };
}