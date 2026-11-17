
import { ChatPromptTemplate } from '@langchain/core/prompts';

export const SYSTEM_BASE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `你是一个智能助手，帮助用户处理剪贴板内容相关的问题。请简洁、准确地回答用户的问题。如果无法回答，请说明原因并建议用户提供更多信息。`,
  ],
  ['placeholder', '{history}'],
  ['human', '{question}'],
]);

export interface SystemBaseInput {
  history: any[];
  question: string;
}