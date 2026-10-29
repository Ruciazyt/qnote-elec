/**
 * AI 流式调用封装
 *
 * 用途：
 *   send-ai-message-stream IPC 会用这个来跑 chain.stream()。
 *   支持 AbortSignal 中途取消、回调每个 token delta。
 *
 * 与 sendMessage 的区别：
 *   sendMessage 用 .invoke() 阻塞等完整结果（用于 validateApiKey / popup 兜底）
 *   本模块用 .stream() 产出 AsyncIterable<AIMessageChunk>（用于打字机效果）
 *
 * 兼容性：
 *   ChatOpenAI / ChatAnthropic 默认 streaming: true（见 providers.ts），
 *   但部分本地模型（Ollama 旧版、某些第三方代理）不支持 stream — 调用方应 try/catch 后兜底到 sendMessage。
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AIMessageChunk } from '@langchain/core/messages';
import { extractTextContent } from './providers';
import { toLangChainMessages } from './providers';
import type { AiMessage } from './types';

export interface StreamOptions {
  model: BaseChatModel;
  /** 接受 AiMessage[]（从 aiService / 旧路径来）或 BaseMessage[]（从 prompt.formatMessages 来） */
  messages: AiMessage[] | any[];
  /** 中途取消信号 */
  signal?: AbortSignal;
  /** 每个 token delta 回调；用于 IPC 推送给渲染进程 */
  onChunk: (delta: string) => void;
  /**
   * LangChain callbacks（可观测性等）
   * 透传给 model.stream，让 callback 层能自动采集 token / 延迟 / 错误
   */
  callbacks?: unknown[];
}

export interface StreamResult {
  /** 累计完整文本内容 */
  content: string;
  /** 实际产出的 chunk 数（用于 debug / 监控） */
  chunkCount: number;
}

/**
 * 跑一次流式调用，回调每个 delta。
 * - 中途 abort：抛 AbortError 或提前 break（取决于 SDK 实现）
 * - 异常：原样向上抛
 */
export async function runChatStream(opts: StreamOptions): Promise<StreamResult> {
  let content = '';
  let chunkCount = 0;

  // 兼容 AiMessage[] 与 BaseMessage[] 两种入参
  //  - AiMessage[]（role: 'user' | 'assistant' | 'system' + content string）→ 转 BaseMessage
  //  - BaseMessage[] → 直接传
  const messages = isBaseMessageArray(opts.messages)
    ? opts.messages
    : toLangChainMessages(opts.messages as AiMessage[]);

  // signal 通过 invoke / stream 的 options 传入；底层 SDK 会自动取消 in-flight HTTP 请求
  // callbacks 透传，让可观测性 callback 能自动采集
  const stream = await opts.model.stream(messages, {
    signal: opts.signal,
    callbacks: opts.callbacks,
  } as any);

  for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
    if (opts.signal?.aborted) break;

    // AIMessageChunk.content 是 string | MessageContentComplex[] — 我们只用文本部分
    const delta = extractTextContent(chunk?.content);
    if (delta) {
      content += delta;
      chunkCount += 1;
      try {
        opts.onChunk(delta);
      } catch (cbErr) {
        // 回调里抛错不应阻断流；只警告
        // eslint-disable-next-line no-console
        console.warn('[ai-stream] onChunk callback error:', cbErr);
      }
    }
  }

  return { content, chunkCount };
}

/**
 * 判断一个数组是否已是 BaseMessage[]
 * 通过 duck-typing：第一个元素有 `getType()` 方法即是
 */
function isBaseMessageArray(messages: any[]): boolean {
  return messages.length > 0 && typeof messages[0]?.getType === 'function';
}