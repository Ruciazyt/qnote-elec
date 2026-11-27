import { describe, expect, it } from "vitest";
import { describeMcpCallError, describeMcpCallErrorText } from "../callError";

describe("describeMcpCallError", () => {
  it("识别 JSON-RPC 错误码", () => {
    const error = Object.assign(new Error("MCP error -32601: tool not found"), {
      code: -32601,
      data: { hint: "unknown" },
    });
    const described = describeMcpCallError(error);
    expect(described.code).toBe(-32601);
    expect(described.message).toBe("tool not found");
    expect(described.data).toEqual({ hint: "unknown" });
  });

  it("沿 cause 链找到最内层错误", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), {
      code: "ECONNREFUSED",
    });
    const outer = new Error("fetch failed", { cause: inner });
    const described = describeMcpCallError(outer);
    expect(described.name).toBe("Error");
    expect(described.message).toBe("connect ECONNREFUSED 127.0.0.1:3000");
    expect(described.codeText).toBe("ECONNREFUSED");
  });

  it("非错误对象没有错误名", () => {
    expect(describeMcpCallError("boom").name).toBeUndefined();
  });
});

describe("describeMcpCallErrorText", () => {
  it("JSON-RPC 错误带上错误码", () => {
    const error = Object.assign(new Error("MCP error -32000: 服务不可用"), {
      code: -32000,
    });
    expect(describeMcpCallErrorText(error)).toContain("-32000");
    expect(describeMcpCallErrorText(error)).toContain("服务不可用");
  });

  it("普通错误回落到错误消息", () => {
    expect(describeMcpCallErrorText(new Error("超时"))).toContain("超时");
  });
});
