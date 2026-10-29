/**
 * 记忆召回场景 — 向 LLM 提供从本地记忆库检索到的相关内容
 *
 * v1.0: 与旧 aiHandlers.ts 第 113-134 行硬编码字符串 1:1 等价
 *
 * 模板拆为两段：
 *   1. system 段：动态拼装记忆摘要 + 相关笔记正文 + 回答要求
 *   2. placeholder + human：注入历史对话 + 当前问题
 *
 * 注意：变量名与 aiHandlers 调用保持 snake_case-friendly 命名，方便 grep
 */

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
  /** 由 buildMemoryDigest() 生成；空字符串仍合法（prompt 不区分） */
  memoryDigest: string;
  /** 格式化后的相关笔记正文，每条以 \n 分隔 */
  relatedNotes: string;
  /** 历史对话（已转为 LangChain 消息字典形式） */
  history: any[];
  question: string;
}