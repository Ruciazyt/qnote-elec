
import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { Knex } from 'knex';

type StoredRole = 'user' | 'assistant' | 'system';

const MESSAGE_TYPE_TO_ROLE: Record<string, StoredRole> = {
  ai: 'assistant',
  human: 'user',
  system: 'system',
  tool: 'user',
};

function rowToMessage(row: { role: string; content: string }): BaseMessage {
  switch (row.role) {
    case 'assistant':
      return new AIMessage(row.content);
    case 'system':
      return new SystemMessage(row.content);
    default:
      return new HumanMessage(row.content);
  }
}

function messageToRow(message: BaseMessage): { role: StoredRole; content: string } {
  const content =
    typeof message.content === 'string'
      ? message.content
      :
        message.content
          .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
          .join('');

  const role = MESSAGE_TYPE_TO_ROLE[message.getType()] ?? 'user';
  return { role, content };
}

export interface KnexChatMessageHistoryOptions {
  DB: Knex;
  sessionId: string;
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

  async getMessages(): Promise<BaseMessage[]> {
    const rows = await this.DB('ai_chat')
      .select('role', 'content')
      .where('session_id', this.sessionId)
      .orderBy('id', 'desc')
      .limit(this.limit);

    return [...rows].reverse().map(rowToMessage);
  }

  async addMessage(message: BaseMessage): Promise<void> {
    const { role, content } = messageToRow(message);
    await this.DB('ai_chat').insert({
      role,
      content,
      session_id: this.sessionId,
      created_at: new Date(),
    });
  }

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

  async clear(): Promise<void> {
    await this.DB('ai_chat').where('session_id', this.sessionId).delete();
  }

  getSessionId(): string {
    return this.sessionId;
  }
}
