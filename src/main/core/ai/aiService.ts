import { log } from '../system/log';
import {
  AiConfig,
  AiMessage,
  AiResponse,
} from './types';
import {
  requestChatCompletion,
  normalizeError,
  ChatRequestOptions,
  VALIDATE_REQUEST_TIMEOUT_MS,
  VALIDATE_MAX_RETRIES,
} from './providers';

export type { AiMessage, AiConfig, AiResponse } from './types';
export { AiApiError, AiConfigError } from './errors';

class AiService {
  async sendMessage(
    messages: AiMessage[],
    config: AiConfig,
    maxTokens?: number,
    options?: ChatRequestOptions
  ): Promise<AiResponse> {
    try {
      log.info('发送 AI 消息', {
        provider: config.provider,
        messageCount: messages.length,
        model: config.model,
      });

      const result = await requestChatCompletion(config, messages, maxTokens, options);

      return {
        content: result.content,
        usage: result.usage,
        model: result.model,
      };
    } catch (err) {
      normalizeError(err, config.provider);
    }
  }

  async validateApiKey(config: AiConfig): Promise<boolean> {
    try {
      await this.sendMessage(
        [{ role: 'user', content: 'Hello' }],
        config,
        50,
        { timeoutMs: VALIDATE_REQUEST_TIMEOUT_MS, maxRetries: VALIDATE_MAX_RETRIES }
      );
      return true;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const isTimeout = err instanceof Error && /timeout|ETIMEDOUT|ECONN/i.test(err.message || '');
      if (isTimeout || status === undefined) {
        log.error('API Key 验证失败：请求超时或无法连接（不是 API Key 的问题）', err);
      } else if (status === 401 || status === 403) {
        log.error('API Key 验证失败：凭据无效（401/403）', err);
      } else {
        log.error('API Key 验证失败', err);
      }
      return false;
    }
  }

}

export const aiService = new AiService();