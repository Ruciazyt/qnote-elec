/**
 * aiService — 兼容 façade
 *
 * 薄壳，内部委托给 src/main/utils/ai/ 模块（LangChain）。
 *
 * 公开 API 保持不变：
 *   - sendMessage(messages, config, maxTokens?) → { content, usage, model? }
 *   - validateApiKey(config) → boolean
 *
 * 调用方（aiHandlers）零改动。
 */

import { log } from './log';
import {
  AiConfig,
  AiMessage,
  AiResponse,
} from './ai/types';
import {
  createChatModel,
  toLangChainMessages,
  normalizeError,
  normalizeUsage,
  extractTextContent,
  ChatModelOptions,
  VALIDATE_REQUEST_TIMEOUT_MS,
  VALIDATE_MAX_RETRIES,
} from './ai/providers';

// 重导出旧路径需要用到的类型 / 错误 — 保持 `import { AiMessage, AiConfig, AiResponse } from '../utils/aiService'` 继续可用
export type { AiMessage, AiConfig, AiResponse } from './ai/types';
export { AiApiError, AiConfigError } from './ai/errors';

class AiService {
  /**
   * 发送消息并等待完整响应（非流式）。流式版本见 ai/streaming.ts。
   */
  async sendMessage(
    messages: AiMessage[],
    config: AiConfig,
    maxTokens?: number,
    /** LangChain callbacks（可观测性等），透传给 model.invoke */
    callbacks?: unknown[],
    /** 超时 / 重试覆盖，见 providers.ts 的 ChatModelOptions */
    options?: ChatModelOptions,
  ): Promise<AiResponse> {
    try {
      log.info('发送 AI 消息', {
        provider: config.provider,
        messageCount: messages.length,
        model: config.model,
      });

      const model = createChatModel(config, maxTokens, options);
      const lcMessages = toLangChainMessages(messages);

      const result = await model.invoke(lcMessages, { callbacks } as any);

      // LangChain 1.x 把 response_metadata 的类型收窄成 Partial<unknown>，
      // 运行时字段（model_name）仍在，但 TS 不允许直接点取。
      // 这里安全地取出 model_name 用于日志/调试，不做类型断言。
      const responseMeta = result.response_metadata as
        | { model_name?: string }
        | undefined;

      return {
        content: extractTextContent(result.content),
        usage: normalizeUsage(result.usage_metadata),
        model: responseMeta?.model_name,
      };
    } catch (err) {
      normalizeError(err, config.provider);
    }
  }

  /**
   * 验证 API Key 是否有效（设置页「验证」按钮用）
   *
   * 用 20 秒超时 + 不重试：这是个探活按钮，用户等 20 秒还拿不到结果就该判
   * 失败，而不是盯着「验证中...」转圈。之前没设超时，上游响应不结束时
   * OpenAI SDK 默认要等 600 秒再重试两次，按钮能转十几分钟。
   *
   * 注意 catch 里必须区分「凭据无效」和「连不上/超时」—— 两者都会让用户去
   * 检查 API Key，但后者去检查 API Key 是白费功夫，方向完全错了。
   */
  async validateApiKey(config: AiConfig): Promise<boolean> {
    try {
      await this.sendMessage(
        [{ role: 'user', content: 'Hello' }],
        config,
        50,
        undefined,
        { timeoutMs: VALIDATE_REQUEST_TIMEOUT_MS, maxRetries: VALIDATE_MAX_RETRIES },
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