
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AIMessageChunk } from '@langchain/core/messages';
import { extractTextContent, toLangChainMessages } from "./providers";
import type { AiMessage } from './types';

export interface StreamOptions {
  model: BaseChatModel;
  messages: AiMessage[] | any[];
  signal?: AbortSignal;
  onChunk: (delta: string) => void;
  callbacks?: unknown[];
}

export interface StreamResult {
  content: string;
  chunkCount: number;
}

export async function runChatStream(opts: StreamOptions): Promise<StreamResult> {
  let content = '';
  let chunkCount = 0;

  const messages = isBaseMessageArray(opts.messages)
    ? opts.messages
    : toLangChainMessages(opts.messages as AiMessage[]);

  const stream = await opts.model.stream(messages, {
    signal: opts.signal,
    callbacks: opts.callbacks,
  } as any);

  for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
    if (opts.signal?.aborted) break;

    const delta = extractTextContent(chunk?.content);
    if (delta) {
      content += delta;
      chunkCount += 1;
      try {
        opts.onChunk(delta);
      } catch (cbErr) {
        // eslint-disable-next-line no-console
        console.warn('[ai-stream] onChunk callback error:', cbErr);
      }
    }
  }

  return { content, chunkCount };
}

function isBaseMessageArray(messages: any[]): boolean {
  return messages.length > 0 && typeof messages[0]?.getType === 'function';
}