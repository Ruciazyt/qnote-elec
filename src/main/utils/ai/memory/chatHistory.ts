/**
 * KnexChatMessageHistory — 把 LangChain 的 chat history 抽象接到现有的 ai_chat 表
 *
 * 为什么要这层：
 *   ai_chat 表已经有 `session_id` 字段和索引，跨会话历史本来就能查（手写 SQL）。
 *   但手写 SQL 把「LangChain 消息 ↔ 数据库行」的映射硬编码在 handler 里，
 *   换 storage（文件 / 另一个 DB）就得改 handler。这里把它收敛成一个类，
 *   handler 只管「给 sessionId，拿 Runnable」。
 *
 * 依赖：仅 @langchain/core（已装），零新增。
 *
 * 注意：ai_chat 落库由现有 handler 负责（同时要写 session 元数据、preview 等），
 *   所以 addMessage 只在「需要补写单条」时使用；主流程仍走 handler 的批量 insert。
 *   这个类保证两边写出的行结构完全一致。
 */

import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { Knex } from 'knex';

/** ai_chat.role 的取值范围 */
type StoredRole = 'user' | 'assistant' | 'system';

/**
 * LangChain MessageType → ai_chat.role 的显式映射
 *
 * 为什么不能直接 `getType() as StoredRole`：
 *   LangChain 的 MessageType 是 "ai" / "human" / "system"，
 *   而 ai_chat.role 存的是 "assistant" / "user" / "system" ——
 *   两者字面量不同，直接断言会在运行时把 "ai" 写成 "assistant"，
 *   把 "human" 写成 "user"，属于静默的数据污染。
 */
const MESSAGE_TYPE_TO_ROLE: Record<string, StoredRole> = {
  ai: 'assistant',
  human: 'user',
  system: 'system',
  // tool 消息目前不落 ai_chat（工具调用走 runAgent 的中间态），
  // 但为完整性映射到 user，读取时 rowToMessage 会当成 human 处理
  tool: 'user',
};

/** DB 行 → LangChain Message */
function rowToMessage(row: { role: string; content: string }): BaseMessage {
  switch (row.role) {
    case 'assistant':
      return new AIMessage(row.content);
    case 'system':
      return new SystemMessage(row.content);
    default:
      // 'user' 以及历史遗留的未知值都按 human 处理
      return new HumanMessage(row.content);
  }
}

/** LangChain Message → ai_chat 行 */
function messageToRow(message: BaseMessage): { role: StoredRole; content: string } {
  const content =
    typeof message.content === 'string'
      ? message.content
      : // 多模态 content 退化为文本序列化（当前项目只存纯文本）
        message.content
          .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
          .join('');

  // 走显式映射表，未知类型兜底为 'user'（不静默写成 assistant）
  const role = MESSAGE_TYPE_TO_ROLE[message.getType()] ?? 'user';
  return { role, content };
}

export interface KnexChatMessageHistoryOptions {
  DB: Knex;
  /** 目标会话 id（对应 ai_chat.session_id） */
  sessionId: string;
  /** 读取时最多取多少条（从新到旧截断），默认 20 —— 与旧实现的 limit 20 保持一致 */
  limit?: number;
}

export class KnexChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ['qnote', 'memory', 'knex_chat_history'];

  private readonly DB: Knex;
  private readonly sessionId: string;
  private readonly limit: number;

  constructor(opts: KnexChatMessageHistoryOptions) {
    super();
    this.DB = opts.DB;
    this.sessionId = opts.sessionId;
    this.limit = opts.limit ?? 20;
  }

  /**
   * 按时间正序返回最近 limit 条历史。
   * SQL 先按 id desc 取 limit 条（走 idx 更快），再在 JS 里反转成正序。
   */
  async getMessages(): Promise<BaseMessage[]> {
    const rows = await this.DB('ai_chat')
      .select('role', 'content')
      .where('session_id', this.sessionId)
      .orderBy('id', 'desc')
      .limit(this.limit);

    // 倒序取出来再翻回正序。reverse() 是原地修改，copy 一份再翻，
    // 免得把 rows 本身给改了（调用方要是还持有它就会踩坑）
    return [...rows].reverse().map(rowToMessage);
  }

  /** 写入单条消息到当前会话 */
  async addMessage(message: BaseMessage): Promise<void> {
    const { role, content } = messageToRow(message);
    await this.DB('ai_chat').insert({
      role,
      content,
      session_id: this.sessionId,
      created_at: new Date(),
    });
  }

  /** 批量写入（覆写基类默认的逐条循环，减少 DB 往返） */
  async addMessages(messages: BaseMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const now = new Date();
    await this.DB('ai_chat').insert(
      messages.map((message) => {
        const { role, content } = messageToRow(message);
        return { role, content, session_id: this.sessionId, created_at: now };
      })
    );
  }

  /** 清空当前会话的历史（不删 ai_chat_session 元数据） */
  async clear(): Promise<void> {
    await this.DB('ai_chat').where('session_id', this.sessionId).delete();
  }

  getSessionId(): string {
    return this.sessionId;
  }
}
