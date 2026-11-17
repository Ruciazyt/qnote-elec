// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import knexFactory, { type Knex } from "knex";
import { DEFAULT_AI_CHAT_SESSION_ID } from "../../../shared/ai/constants/aiChat";
import {
  AI_CHAT_SESSION_DELETED,
  ensureAiChatSession,
  resolveAiChatSession,
} from "./chatSession";

describe("AI 会话解析", () => {
  let DB: Knex;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await DB.schema.createTable("ai_chat_session", (table) => {
      table.string("id").primary();
      table.string("title").notNullable();
      table.text("preview").notNullable().defaultTo("");
      table.timestamp("created_at");
      table.timestamp("updated_at");
    });
  });

  it("默认会话缺行时自动补建，不报「已删除」", async () => {
    const result = await resolveAiChatSession(DB, DEFAULT_AI_CHAT_SESSION_ID);

    expect(result).toEqual({ ok: true });
    const row = await DB.from("ai_chat_session")
      .where({ id: DEFAULT_AI_CHAT_SESSION_ID })
      .first();
    expect(row?.id).toBe(DEFAULT_AI_CHAT_SESSION_ID);
  });

  it("默认会话补建后标题是「新建对话」，第一轮再按消息改名", async () => {
    await resolveAiChatSession(DB, DEFAULT_AI_CHAT_SESSION_ID);

    const row = await DB.from("ai_chat_session")
      .where({ id: DEFAULT_AI_CHAT_SESSION_ID })
      .first();
    expect(row?.title).toBe("新建对话");
  });

  it("已存在的会话直接放行", async () => {
    await ensureAiChatSession(DB, "s-1", "北京有哪些皮肤科医院比较好？");

    const result = await resolveAiChatSession(DB, "s-1");

    expect(result).toEqual({ ok: true });
  });

  it("用户自己建的会话被删了，仍然报「已不存在或已删除」", async () => {
    const result = await resolveAiChatSession(DB, "deleted-session");

    expect(result).toEqual({ ok: false, reason: AI_CHAT_SESSION_DELETED });
    expect(AI_CHAT_SESSION_DELETED).toBe("此对话已不存在或已删除");
  });

  it("ensureAiChatSession 是幂等的：已存在就不再插一行", async () => {
    await ensureAiChatSession(DB, "s-2", "第一次");
    await ensureAiChatSession(DB, "s-2", "第二次");

    const rows = await DB.from("ai_chat_session").where({ id: "s-2" });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("第一次");
  });
});
