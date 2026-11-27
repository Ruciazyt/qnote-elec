// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SseParser } from "../sse";

describe("SseParser", () => {
  it("按空行切分事件", () => {
    const parser = new SseParser();
    const messages = parser.push('data: {"type":"a"}\n\ndata: {"type":"b"}\n\n');
    expect(messages).toHaveLength(2);
    expect(messages[0].data).toBe('{"type":"a"}');
    expect(messages[1].data).toBe('{"type":"b"}');
  });

  it("跨 chunk 拼接半截事件", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"ty')).toHaveLength(0);
    expect(parser.push('pe":"a"}\n')).toHaveLength(0);
    const messages = parser.push("\n");
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe('{"type":"a"}');
  });

  it("合并多行 data", () => {
    const parser = new SseParser();
    const messages = parser.push("data: 第一行\ndata: 第二行\n\n");
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe("第一行\n第二行");
  });

  it("忽略注释行与心跳", () => {
    const parser = new SseParser();
    const messages = parser.push(": heartbeat\n\ndata: {}\n\n");
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe("{}");
  });

  it("兼容 CRLF", () => {
    const parser = new SseParser();
    const messages = parser.push('data: {"type":"a"}\r\n\r\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe('{"type":"a"}');
  });

  it("取出 event 与 id 字段", () => {
    const parser = new SseParser();
    const messages = parser.push("event: message\nid: evt_1\ndata: {}\n\n");
    expect(messages[0].event).toBe("message");
    expect(messages[0].id).toBe("evt_1");
  });

  it("没有 data 的块不产出事件", () => {
    const parser = new SseParser();
    expect(parser.push("event: ping\n\n")).toHaveLength(0);
  });

  it("flush 收尾最后半截", () => {
    const parser = new SseParser();
    parser.push('data: {"type":"a"}');
    const messages = parser.flush();
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe('{"type":"a"}');
  });
});
