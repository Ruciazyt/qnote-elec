// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import knexFactory, { type Knex } from "knex";

vi.mock("../nativeAi", () => ({
  buildSessionPreview: (text: string | null) => (text ?? "").slice(0, 60),
}));

import {
  persistAiChatExchange,
  removeAiChatRow,
  startAiChatAssistantRow,
  updateAiChatAssistantRow,
} from "../chatPersistence";

let DB: Knex;
const SESSION_ID = "session-1";

beforeEach(async () => {
  DB = knexFactory({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  await DB.schema.createTable("ai_chat_session", (table) => {
    table.string("id").primary();
    table.string("title").notNullable();
    table.string("preview").notNullable().defaultTo("");
    table.timestamp("created_at").defaultTo(DB.fn.now());
    table.timestamp("updated_at").defaultTo(DB.fn.now());
  });
  await DB.schema.createTable("ai_chat", (table) => {
    table.increments("id").primary();
    table.string("session_id").notNullable();
    table.string("role").notNullable();
    table.text("content").defaultTo("");
    table.text("blocks").defaultTo("");
    table.text("images").defaultTo("");
    table.timestamp("created_at").defaultTo(DB.fn.now());
  });
  await DB("ai_chat_session").insert({
    id: SESSION_ID,
    title: "新建对话",
    preview: "",
  });
});

afterEach(async () => {
  await DB.destroy();
});

describe("会话落库", () => {
  it("默认落一条用户消息与一条 AI 回复", async () => {
    await persistAiChatExchange(DB, SESSION_ID, "你好", "在");
    const rows = await DB("ai_chat").select("role", "content").orderBy("id");
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[0].content).toBe("你好");
    expect(rows[1].content).toBe("在");
  });

  it("关掉用户消息时只落 AI 回复", async () => {
    await persistAiChatExchange(DB, SESSION_ID, "内部提示词", "干完了", [], undefined, {
      includeUserMessage: false,
      titleSource: "改个 README",
    });
    const rows = await DB("ai_chat").select("role", "content").orderBy("id");
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("assistant");
    expect(rows[0].content).toBe("干完了");
  });

  it("会话预览用指定的来源", async () => {
    await persistAiChatExchange(DB, SESSION_ID, "内部提示词", "干完了", [], undefined, {
      includeUserMessage: false,
      titleSource: "改个 README",
    });
    const session = await DB("ai_chat_session").where("id", SESSION_ID).first();
    expect(session.preview).toBe("改个 README");
  });

  it("会话已有标题时不被覆盖", async () => {
    await DB("ai_chat_session").where("id", SESSION_ID).update({ title: "GitLab 任务" });
    await persistAiChatExchange(DB, SESSION_ID, "内部提示词", "干完了", [], undefined, {
      includeUserMessage: false,
      titleSource: "改个 README",
    });
    const session = await DB("ai_chat_session").where("id", SESSION_ID).first();
    expect(session.title).toBe("GitLab 任务");
  });
});

describe("增量落库", () => {
  it("先建空行再逐步写入内容与分块", async () => {
    const rowId = await startAiChatAssistantRow(DB, SESSION_ID, "改个 README");
    const created = await DB("ai_chat").where("id", rowId).first();
    expect(created.role).toBe("assistant");
    expect(created.content).toBe("");
    expect(created.blocks).toBe("");

    await updateAiChatAssistantRow(DB, rowId, "改完了", [
      { kind: "thinking", text: "先看看仓库" },
      { kind: "tool", call: { id: "t1", name: "gitlab_get_issue", args: {} } },
    ]);

    const updated = await DB("ai_chat").where("id", rowId).first();
    expect(updated.content).toBe("改完了");
    expect(JSON.parse(updated.blocks)).toHaveLength(2);
  });

  it("建行时把会话预览写成指令来源", async () => {
    await startAiChatAssistantRow(DB, SESSION_ID, "清空 readme");
    const session = await DB("ai_chat_session").where("id", SESSION_ID).first();
    expect(session.preview).toBe("清空 readme");
  });

  it("删掉没有内容的空行", async () => {
    const rowId = await startAiChatAssistantRow(DB, SESSION_ID, "空跑");
    await removeAiChatRow(DB, rowId);
    const rows = await DB("ai_chat").where("id", rowId);
    expect(rows).toHaveLength(0);
  });
});
