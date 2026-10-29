/**
 * 默认系统提示 — 当记忆库没召回任何相关内容时使用
 *
 * v1.0: 与旧 aiHandlers.ts 第 138-140 行硬编码字符串 1:1 等价
 * 后续版本变化必须在此文件追加 CHANGELOG 条目
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';

export const SYSTEM_BASE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个智能助手，帮助用户处理剪贴板内容相关的问题。请简洁、准确地回答用户的问题。如果无法回答，请说明原因并建议用户提供更多信息。`,
  ],
  ['placeholder', '{history}'],
  ['human', '{question}'],
]);

/** 该 prompt 需要的输入变量 */
export interface SystemBaseInput {
  history: any[];
  question: string;
}