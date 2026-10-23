/**
 * Provider 适配层 — LangChain ChatModel 工厂
 *
 * 替换旧 aiService.ts 中手写的 fetch + 分支逻辑。
 * 暴露：
 *   - createChatModel(config)  → BaseChatModel 实例
 *   - toLangChainMessages(msgs) → BaseMessage[]
 *   - normalizeError(err)      → 抛 AiApiError 或 AiConfigError
 *
 * 兼容旧行为要点：
 *   1. baseUrl 是「兼容三种形态」: 裸根 / 含 /v1 / 含 /v1/chat/completions
 *      → 全部规整成 SDK 接受的裸 base（OpenAI 兼容 → baseURL；Anthropic → anthropicApiUrl）
 *   2. Claude 不在 messages 数组里放 system role，而是 SDK 自动提到顶层 system 字段
 *   3. max_tokens / temperature 与旧实现保持一致
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

import { log } from '../log';
import { estimateTextTokens } from './memory/tokenEstimator';
import { installOfflineTokenCounter } from './offlineTokenCounter';
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

/**
 * 本地 token 计数（覆写 LangChain 的 getNumTokens）
 *
 * ## 为什么必须覆写
 *
 * LangChain 基类的 getNumTokens 会：
 *   1. 先用 `字符数 / 4` 粗估
 *   2. 再尝试 encodingForModel() → 从 tiktoken.pages.dev 下载 BPE 词表
 *
 * 两个问题，都命中我们：
 *
 *   - **联网必然失败**：词表托管在 Cloudflare，国内网络连不上，
 *     每次调用空等10 秒超时，p-retry 还会重试。日志被
 *     "Failed to calculate number of tokens" 刷满，真正的报错反而看不见。
 *   - **就算通了也拿不到精确值**：tiktoken 只认识 OpenAI 的模型名。
 *     我们用的 MiniMax-M3 会直接抛 Unknown model，然后照样降级。
 *     也就是说这个网络请求注定是白费。
 *
 * ## 为什么复用 tokenEstimator 而不是自己再写一套
 *
 * 会话压缩（compactor.ts）判断要不要压缩时，用的正是 tokenEstimator。
 * 覆写成同一套算法后，「LangChain 认为的 token 数」和「压缩阈值判断依据的
 * token 数」口径一致 —— 否则同一段文本被两套算法各算一遍（中文尤其吃亏：
 * 汉字通常 1~2 token/字，而 `length/4` 会严重低估），压缩时机就会失准。
 *
 * 精度上：估算值用于「要不要压缩」这类阈值判断，偏差 20% 完全可接受；
 * 真正计费用的是 provider 返回的 usage，不走这里。
 */
async function getNumTokensLocal(content: unknown): Promise<number> {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    // 与 LangChain 基类一致的 ContentBlock 处理：只取文本部分
    text = content
      .map((item: any) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text' && 'text' in item) return item.text;
        return '';
      })
      .join('');
  }

  // 每条消息有 role / 分隔符等固定开销
  return estimateTextTokens(text) + PER_MESSAGE_OVERHEAD_TOKENS;
}

/** LangChain 基类里对每条消息计入的固定结构开销 */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * 在模型实例上覆写 getNumTokens。
 *
 * 注意这只挡住**显式调用**那条路（例如会话压缩里算 token 数）。
 * @langchain/openai 在流式响应结束后统计 usage 时走的是它内部持有的另一个实例，
 * 绕不过实例属性 —— 那条路由 offlineTokenCounter 在模块层堵住，两者缺一不可。
 */
function installLocalTokenCounter(model: unknown): void {
  (model as Record<string, unknown>).getNumTokens = getNumTokensLocal;
}

/**
 * 把 baseUrl 规整成 SDK 接受的「裸 base」。
 *
 * ## 两种协议对路径的要求正好相反 —— 这是最容易踩的坑
 *
 *   - **OpenAI 兼容**（ChatOpenAI）：SDK 只追加 `/chat/completions`，
 *     所以 baseUrl **必须自带 `/v1`**。填裸根会打到 `https://host/chat/completions`
 *     → 实测 404。
 *   - **Anthropic 兼容**（ChatAnthropic → @anthropic-ai/sdk 0.122）：SDK 追加的是
 *     完整路径 `/v1/messages`，其 baseURL 默认 `https://api.anthropic.com`，
 *     所以 baseUrl **不能带 `/v1`** —— 带了会拼成 `/v1/v1/messages` → 实测 404。
 *
 * 同一个输入框要在两种协议之间切换，而用户切协议时经常忘了改端点，于是：
 *
 *   | baseUrl 填的      | 协议      | 实际请求                        | 结果 |
 *   |-------------------|-----------|---------------------------------|------|
 *   | .../anthropic     | claude    | .../anthropic/v1/messages       | 200  |
 *   | .../anthropic     | openai    | .../anthropic/chat/completions  | 404  |
 *   | .../v1            | openai    | .../v1/chat/completions         | 200  |
 *   | .../v1            | claude    | .../v1/v1/messages              | 404  |
 *
 * 下面两条规则把"对家前缀"归一掉，同时**不碰未知路径** —— 第三方聚合网关
 * （one-api / new-api）、Ollama、LM Studio 的 baseUrl 都带自有路径，必须原样透传。
 */
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
    // 显式填了完整路径 → 剥掉尾段，交给 SDK 重新加。
    // 不剥的话 /v1 会和 SDK 追加的 /v1/messages 叠成 /v1/v1/messages。
    if (trimmed.endsWith('/v1')) {
      return trimmed.slice(0, -'/v1'.length);
    }
    // 保留裸根或 /anthropic 这类前缀 — ChatAnthropic 会自动加 /v1/messages
    return trimmed;
  }

  // openai-compatible
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length);
  }
  // MiniMax 把两个兼容端点挂在不同路径下：Anthropic 在 /anthropic，OpenAI 在 /v1。
  // 用户切协议没改端点时，这里把已知的"对家前缀"换成 /v1；
  // 其它路径（代理网关的自定义 base）原样保留。
  if (/\/anthropic$/i.test(trimmed)) {
    return `${trimmed.slice(0, -'/anthropic'.length)}/v1`;
  }
  // 保留 /v1 结尾或裸根 — ChatOpenAI 会自动加 /chat/completions
  return trimmed;
}

/**
 * 把历史值 'deepseek' 规整成 'openai'（行为相同：走 OpenAI 兼容协议）。
 * 兼容老数据库 settings 表里存的 provider 字符串。
 */
export function normalizeProvider(provider: AiProvider): 'openai' | 'claude' {
  return provider === 'claude' ? 'claude' : 'openai';
}

/**
 * 请求超时与重试上限
 *
 * ## 为什么必须显式设
 *
 * ChatOpenAI / ChatAnthropic 不传 timeout 时，底层 OpenAI SDK 的默认值是
 * **600 秒**，再叠加 maxRetries（默认 2 次重试）。上游只要「接受了请求但
 * 响应流不结束」，调用方就会干等十几分钟 —— 表现就是设置页那个「验证中...」
 * 转圈按钮一直转，用户既等不到结果也等不到报错。
 *
 * 实测过：一个只发 chunk、绝不 end() 的 mock 服务端，streaming:true 和
 * streaming:false 都会无限挂住；没有任何分支能兜住这种情况，只能靠超时。
 *
 * 设置页「验证」按钮用更短的超时：它只是探活，用户等 20 秒还拿不到结果就
 * 该判失败了，不该让他盯着转圈。
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const VALIDATE_REQUEST_TIMEOUT_MS = 20_000;
/** 设置页验证不重试 —— 探活重试没有意义，只会让人多等几倍时间 */
export const VALIDATE_MAX_RETRIES = 0;

/** 单次模型调用的可调项 */
export interface ChatModelOptions {
  /** 覆盖单次请求超时（毫秒） */
  timeoutMs?: number;
  /** 覆盖重试次数 */
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

  // 模块层：断掉 tiktoken 词表的联网下载（@langchain/openai 流式结束后统计 usage 时必经）
  installOfflineTokenCounter();

  // overrideMaxTokens 优先（validateApiKey 传 50 之类小值用），否则用各 provider 默认
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
    // 变量名避开外层的 model（那是模型名字符串）
    const chatModel = new ChatOpenAI({
      model,
      apiKey: config.apiKey,
      // ChatOpenAI.configuration 是 OpenAI SDK 4.x 的可选字段，用于第三方 baseURL
      configuration: baseUrl ? { baseURL: baseUrl } : undefined,
      temperature,
      maxTokens,
      timeout,
      maxRetries,
      // 默认开启 streaming 能力；调用方通过 .stream() 或 .invoke() 决定是否真的流
      streaming: true,
    });
    // 实例上覆写，而不是改原型 —— 只影响本应用创建的 model，
    // 不污染 @langchain/openai 的全局行为（其它地方若真的需要精确计数仍可用默认实现）
    installLocalTokenCounter(chatModel);
    return chatModel;
  }

  // normalized === 'claude'
  // 注意 Anthropic 这边没有顶层 timeout 字段，超时要塞进 clientOptions
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

/** AiMessage[] → LangChain BaseMessage[] */
export function toLangChainMessages(messages: AiMessage[]) {
  return messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}

/**
 * 把 LangChain / OpenAI SDK / Anthropic SDK 抛出的错统一拍平。
 * 调用方只需 `try { ... } catch (e) { normalizeError(e, provider); }`。
 */
export function normalizeError(err: unknown, provider: AiProvider): never {
  if (err instanceof AiConfigError) {
    throw err;
  }

  const e = err as any;
  const status = e?.status ?? e?.response?.status as number | undefined;
  const message = e?.error?.message ?? e?.message ?? String(err);

  log.error(`AI 调用失败 [${provider}]`, { status, message });
  throw new AiApiError(`AI 调用失败: ${message}`, status, provider);
}

/** 从 LangChain AIMessageChunk 提取纯文本 content（兼容 string / array / object 三种形态） */
export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return content ? String(content) : '';
}

/** 从 LangChain result.usage_metadata 规整成旧 AiUsage 格式 */
export function normalizeUsage(usageMeta: any): AiUsage | undefined {
  if (!usageMeta) return undefined;
  // LangChain 标准字段
  const input = usageMeta.input_tokens ?? usageMeta.prompt_tokens ?? 0;
  const output = usageMeta.output_tokens ?? usageMeta.completion_tokens ?? 0;
  const total = usageMeta.total_tokens ?? input + output;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: total,
  };
}