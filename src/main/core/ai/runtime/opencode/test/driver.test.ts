// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { OpencodeDriver } from "../driver";
import type { OpencodeEventEnvelope } from "../protocol";

type Listener = (event: OpencodeEventEnvelope) => void;

function createClient(events: OpencodeEventEnvelope[], response: unknown = { info: {}, parts: [] }) {
  let listener: Listener | null = null;
  const client = {
    subscribeEvents: vi.fn(async (signal: AbortSignal, onEvent: Listener) => {
      listener = onEvent;
      for (const event of events) {
        if (signal.aborted) break;
        onEvent(event);
      }
      return new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }),
    sendMessage: vi.fn(async () => response),
    abortSession: vi.fn(async () => true),
  };
  return { client: client as any, emit: (event: OpencodeEventEnvelope) => listener?.(event) };
}

const sessionID = "ses_test";

describe("opencode driver", () => {
  it("把会话目录传给事件订阅", async () => {
    const { client } = createClient([]);
    const driver = new OpencodeDriver({
      client,
      sessionID,
      directory: "C:\\repos\\demo",
    });
    await driver.run([{ type: "text", text: "hi" }]);
    const calls = (client.subscribeEvents as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0][2]).toEqual({ directory: "C:\\repos\\demo" });
  });

  it("没有目录时不带查询参数", async () => {
    const { client } = createClient([]);
    const driver = new OpencodeDriver({ client, sessionID });
    await driver.run([{ type: "text", text: "hi" }]);
    const calls = (client.subscribeEvents as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0][2]).toBeUndefined();
  });

  it("文本增量按 part 累积且不重复", async () => {
    const events: OpencodeEventEnvelope[] = [
      {
        id: "1",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { id: "prt_1", sessionID, type: "text", text: "" },
        },
      },
      {
        id: "2",
        type: "message.part.delta",
        properties: { sessionID, partID: "prt_1", field: "text", delta: "你好" },
      },
      {
        id: "3",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { id: "prt_1", sessionID, type: "text", text: "你好" },
        },
      },
    ];
    const { client } = createClient(events);
    const chunks: string[] = [];
    const driver = new OpencodeDriver({
      client,
      sessionID,
      handlers: { onText: (delta) => chunks.push(delta) },
    });
    const result = await driver.run([{ type: "text", text: "hi" }]);
    expect(chunks).toEqual(["你好"]);
    expect(result.text).toBe("你好");
  });

  it("reasoning 走思考通道", async () => {
    const events: OpencodeEventEnvelope[] = [
      {
        id: "1",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { id: "prt_r", sessionID, type: "reasoning", text: "" },
        },
      },
      {
        id: "2",
        type: "message.part.delta",
        properties: { sessionID, partID: "prt_r", field: "text", delta: "想一下" },
      },
    ];
    const { client } = createClient(events);
    const thinking: string[] = [];
    const driver = new OpencodeDriver({
      client,
      sessionID,
      handlers: { onThinking: (delta) => thinking.push(delta) },
    });
    const result = await driver.run([{ type: "text", text: "hi" }]);
    expect(thinking).toEqual(["想一下"]);
    expect(result.thinking).toBe("想一下");
    expect(result.text).toBe("");
  });

  it("工具调用与结果各只发一次", async () => {
    const events: OpencodeEventEnvelope[] = [
      {
        id: "1",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_t",
            sessionID,
            type: "tool",
            tool: "qnote_get_todos",
            callID: "call_1",
            state: { status: "pending", input: { limit: 5 } },
          },
        },
      },
      {
        id: "2",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_t",
            sessionID,
            type: "tool",
            tool: "qnote_get_todos",
            callID: "call_1",
            state: { status: "running", input: { limit: 5 } },
          },
        },
      },
      {
        id: "3",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_t",
            sessionID,
            type: "tool",
            tool: "qnote_get_todos",
            callID: "call_1",
            state: { status: "completed", output: "[]" },
          },
        },
      },
    ];
    const { client } = createClient(events);
    const calls: string[] = [];
    const results: string[] = [];
    const driver = new OpencodeDriver({
      client,
      sessionID,
      handlers: {
        onToolCall: (call) => calls.push(call.name),
        onToolResult: (r) => results.push(r.content),
      },
    });
    const result = await driver.run([{ type: "text", text: "hi" }]);
    expect(calls).toEqual(["qnote_get_todos"]);
    expect(results).toEqual(["[]"]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolCalls[0].args).toEqual({ limit: 5 });
  });

  it("工具参数晚到时补齐并再通知一次", async () => {
    const events: OpencodeEventEnvelope[] = [
      {
        id: "1",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_t",
            sessionID,
            type: "tool",
            tool: "qnote_get_todos",
            callID: "call_1",
            state: { status: "pending", input: {} },
          },
        },
      },
      {
        id: "2",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_t",
            sessionID,
            type: "tool",
            tool: "qnote_get_todos",
            callID: "call_1",
            state: { status: "running", input: { status: "pending" } },
          },
        },
      },
    ];
    const { client } = createClient(events);
    const calls: Array<{ id: string; args: Record<string, any> }> = [];
    const driver = new OpencodeDriver({
      client,
      sessionID,
      handlers: { onToolCall: (call) => calls.push({ id: call.id, args: call.args }) },
    });
    const result = await driver.run([{ type: "text", text: "hi" }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual({});
    expect(calls[1].args).toEqual({ status: "pending" });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].args).toEqual({ status: "pending" });
  });

  it("工具报错标记 isError", async () => {
    const events: OpencodeEventEnvelope[] = [
      {
        id: "1",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_t",
            sessionID,
            type: "tool",
            tool: "qnote_bash",
            callID: "call_x",
            state: { status: "error", error: "权限被拒" },
          },
        },
      },
    ];
    const { client } = createClient(events);
    const driver = new OpencodeDriver({ client, sessionID });
    const result = await driver.run([{ type: "text", text: "hi" }]);
    expect(result.toolResults[0].isError).toBe(true);
    expect(result.toolResults[0].content).toBe("权限被拒");
  });

  it("忽略别的会话的事件", async () => {
    const events: OpencodeEventEnvelope[] = [
      {
        id: "1",
        type: "message.part.delta",
        properties: {
          sessionID: "ses_other",
          partID: "prt_x",
          field: "text",
          delta: "别的会话",
        },
      },
    ];
    const { client } = createClient(events);
    const driver = new OpencodeDriver({ client, sessionID });
    const result = await driver.run([{ type: "text", text: "hi" }]);
    expect(result.text).toBe("");
  });

  it("用户自己的消息不当成模型正文", async () => {
    const events: OpencodeEventEnvelope[] = [
      {
        id: "1",
        type: "message.updated",
        properties: { sessionID, info: { id: "msg_user", role: "user" } },
      },
      {
        id: "2",
        type: "message.part.updated",
        properties: {
          sessionID,
          part: { id: "prt_u", sessionID, messageID: "msg_user", type: "text", text: "用户输入" },
        },
      },
      {
        id: "3",
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: "msg_user",
          partID: "prt_u",
          field: "text",
          delta: "用户输入",
        },
      },
      {
        id: "4",
        type: "message.updated",
        properties: { sessionID, info: { id: "msg_ai", role: "assistant" } },
      },
      {
        id: "5",
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: "msg_ai",
          partID: "prt_a",
          field: "text",
          delta: "模型回复",
        },
      },
    ];
    const { client } = createClient(events);
    const chunks: string[] = [];
    const driver = new OpencodeDriver({
      client,
      sessionID,
      handlers: { onText: (delta) => chunks.push(delta) },
    });
    const result = await driver.run([{ type: "text", text: "用户输入" }]);
    expect(chunks).toEqual(["模型回复"]);
    expect(result.text).toBe("模型回复");
  });

  it("模型报错时把错误带出来", async () => {
    const { client } = createClient([], {
      info: { error: { name: "ProviderError", data: { message: "额度用完" } } },
      parts: [],
    });
    const driver = new OpencodeDriver({ client, sessionID });
    const result = await driver.run([{ type: "text", text: "hi" }]);
    expect(result.error).toBe("额度用完");
  });
});
