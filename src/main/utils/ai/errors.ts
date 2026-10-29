/**
 * AI 模块统一错误模型
 *
 * 目的：把 LangChain / OpenAI SDK / Anthropic SDK 抛出的五花八门的错误
 * 归一化成两类：
 *   - AiConfigError: 配置错误（缺 API Key、provider 不识别）
 *   - AiApiError:    调用错误（网络、4xx/5xx、解析失败）
 *
 * 这样 aiHandlers 只需展示 `err.message` 给用户，不需要看嵌套 4 层的 cause。
 */

import type { AiProvider } from './types';

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

export class AiApiError extends Error {
  public readonly status?: number;
  public readonly provider?: AiProvider;

  constructor(
    message: string,
    status?: number,
    provider?: AiProvider
  ) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.provider = provider;
  }
}