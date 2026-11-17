
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

import { log } from '../system/log';
import { estimateTextTokens } from './memory/tokenEstimator';
import { installOfflineTokenCounter } from "./offlineTokenCounter";
import {
  AiConfig,
  AiMessage,
  AiProvider,
  AiUsage,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS,
  DEFAULT_TEMPERATURE,
} from './types';
import { AiApiError, AiConfigError } from './errors';

async function getNumTokensLocal(content: unknown): Promise<number> {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((item: any) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text' && 'text' in item) return item.text;
        return '';
      })
      .join('');
  }

  return estimateTextTokens(text) + PER_MESSAGE_OVERHEAD_TOKENS;
}

const PER_MESSAGE_OVERHEAD_TOKENS = 4;

function installLocalTokenCounter(model: unknown): void {
  (model as Record<string, unknown>).getNumTokens = getNumTokensLocal;
}

export function resolveBaseUrl(
  baseUrl: string | undefined,
  provider: AiProvider
): string | undefined {
  const trimmed = (baseUrl || '').trim().replace(/^((?:[\s\S]*[^/])?)\/+$/, "$1");
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

export function normalizeProvider(provider: AiProvider): 'openai' | 'claude' {
  return provider === 'claude' ? 'claude' : 'openai';
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const VALIDATE_REQUEST_TIMEOUT_MS = 20_000;
export const VALIDATE_MAX_RETRIES = 0;

export interface ChatModelOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export function createChatModel(
  config: AiConfig,
  overrideMaxTokens?: number,
  options?: ChatModelOptions,
): BaseChatModel {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new AiConfigError('请先在设置中配置 AI API Key');
  }

  const normalized = normalizeProvider(config.provider);
  const baseUrl = resolveBaseUrl(config.baseUrl, normalized);
  const model = config.model?.trim() || DEFAULT_MODELS[normalized];

  installOfflineTokenCounter();

  const maxTokens = typeof overrideMaxTokens === 'number' && overrideMaxTokens > 0
    ? overrideMaxTokens
    : DEFAULT_MAX_TOKENS[normalized];
  const temperature = DEFAULT_TEMPERATURE;
  const timeout = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? 2;

  log.info('createChatModel', {
    provider: config.provider,
    normalizedProvider: normalized,
    model,
    maxTokens,
    hasBaseUrl: !!baseUrl,
    timeout,
    maxRetries,
  });

  if (normalized === 'openai') {
    const chatModel = new ChatOpenAI({
      model,
      apiKey: config.apiKey,
      configuration: baseUrl ? { baseURL: baseUrl } : undefined,
      temperature,
      maxTokens,
      timeout,
      maxRetries,
      streaming: true,
    });
    installLocalTokenCounter(chatModel);
    return chatModel;
  }

  const claudeModel = new ChatAnthropic({
    model,
    anthropicApiKey: config.apiKey,
    anthropicApiUrl: baseUrl,
    temperature,
    maxTokens,
    clientOptions: { timeout },
    maxRetries,
    streaming: true,
  });
  installLocalTokenCounter(claudeModel);
  return claudeModel;
}

export function toLangChainMessages(messages: AiMessage[]) {
  return messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
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

export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return typeof content === 'string' ? content : content ? JSON.stringify(content) : '';
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