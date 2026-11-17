
import { ChatPromptTemplate } from '@langchain/core/prompts';

export const MEMORY_RECALL_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `记忆摘要：{memoryDigest}

根据你的问题，我找到了以下相关的历史内容（按相关度排序）：

{relatedNotes}

请基于以上相关内容回答用户的问题。要求：
1. 优先使用上述相关内容来回答问题
2. 如果相关内容能够回答问题，请直接基于这些内容回答
3. 如果内容不够相关或无法回答问题，请明确说明并建议用户提供更多信息
4. 回答要简洁、准确、有用
5. 不要编造或猜测信息`,
  ],
  ['placeholder', '{history}'],
  ['human', '{question}'],
]);

export interface MemoryRecallInput {
  memoryDigest: string;
  relatedNotes: string;
  history: any[];
  question: string;
}