// @vitest-environment node
import { describe, it, expect } from "vitest";
import { BlockBuilder, parseBlocks, serializeBlocks } from "./aiBlocks";

/**
 * AI 回复的增量分块构建器
 *
 * 这是个有状态的流式构建器：事件一条条到，块要边收边切。
 * 最容易出错的地方是 `<think>` 标签被切在两个 chunk 中间 ——
 * SSE 的 chunk 边界和标签边界没有任何关系。
 *
 * 纯逻辑，不碰文件系统。
 */

describe("BlockBuilder 分块顺序", () => {
  it("纯文本就是一块", () => {
    const b = new BlockBuilder();
    b.pushText("你好");

    expect(b.blocks()).toEqual([{ kind: "text", text: "你好" }]);
  });

  it("思考 → 文本按发生顺序排成两块", () => {
    const b = new BlockBuilder();
    b.pushText("<think>我在想</think>答案");

    expect(b.blocks()).toEqual([
      { kind: "thinking", text: "我在想" },
      { kind: "text", text: "答案" },
    ]);
  });

  it("思考 → 工具 → 思考 → 文本 的交错顺序保得住", () => {
    const b = new BlockBuilder();
    b.pushText("<think>先想</think>");
    b.pushToolCall({ id: "c1", name: "搜索", args: { q: "天气" } });
    b.pushText("<think>再想</think>");
    b.pushText("结果");

    const kinds = b.blocks().map((x) => x.kind);
    expect(kinds).toEqual(["thinking", "tool", "thinking", "text"]);
  });

  it("相邻同类块合并成一块（每来一个 chunk 就多一块是错的）", () => {
    const b = new BlockBuilder();
    b.pushText("你");
    b.pushText("好");
    b.pushText("呀");

    expect(b.blocks()).toEqual([{ kind: "text", text: "你好呀" }]);
  });
});

describe("标签被切在 chunk 中间", () => {
  it("开标签被拆开：前半个不算正文", () => {
    const b = new BlockBuilder();
    b.pushText("前面<thi");
    b.pushText("nk>思考内容</think>答案");

    expect(b.blocks()).toEqual([
      { kind: "text", text: "前面" },
      { kind: "thinking", text: "思考内容" },
      { kind: "text", text: "答案" },
    ]);
  });

  it("闭标签被拆开也一样能拼回来", () => {
    const b = new BlockBuilder();
    b.pushText("<think>思考内容</thi");
    b.pushText("nk>答案");

    expect(b.blocks()).toEqual([
      { kind: "thinking", text: "思考内容" },
      { kind: "text", text: "答案" },
    ]);
  });

  it("残缺的前缀在流结束时当正文落下去（不能凭空少字符）", () => {
    const b = new BlockBuilder();
    b.pushText("答案<thi");

    expect(b.blocks()).toEqual([{ kind: "text", text: "答案<thi" }]);
  });

  it("流结束时停在思考块中间，残缺内容算思考", () => {
    const b = new BlockBuilder();
    b.pushText("<think>思考到一半");

    expect(b.blocks()).toEqual([{ kind: "thinking", text: "思考到一半" }]);
  });
});

describe("工具调用与结果", () => {
  it("工具块插在当时的位置，不被挪到前后", () => {
    const b = new BlockBuilder();
    b.pushText("先说");
    b.pushToolCall({ id: "c1", name: "搜索", args: {} });
    b.pushText("后说");

    const blocks = b.blocks();
    expect(blocks[0]).toEqual({ kind: "text", text: "先说" });
    expect(blocks[1].kind).toBe("tool");
    expect(blocks[2]).toEqual({ kind: "text", text: "后说" });
  });

  it("工具结果就地补到对应的工具块上", () => {
    const b = new BlockBuilder();
    b.pushToolCall({ id: "c1", name: "搜索", args: {} });
    b.pushToolResult("c1", "晴天", false);

    const tool = b.blocks()[0];
    expect(tool.kind).toBe("tool");
    if (tool.kind !== "tool") throw new Error("应当是工具块");
    expect(tool.call.result).toBe("晴天");
    expect(tool.call.isError).toBe(false);
  });

  it("找不到对应调用时补一个孤儿结果（UI 上不该凭空少一条）", () => {
    const b = new BlockBuilder();
    b.pushToolResult("不存在的 id", "结果", true);

    const tool = b.blocks()[0];
    expect(tool.kind).toBe("tool");
    if (tool.kind !== "tool") throw new Error("应当是工具块");
    expect(tool.call.name).toBe("未知工具");
    expect(tool.call.result).toBe("结果");
  });
});

describe("落库序列化与还原", () => {
  it("序列化再还原，块顺序不变", () => {
    const b = new BlockBuilder();
    b.pushText("<think>想</think>答");
    b.pushToolCall({ id: "c1", name: "搜索", args: { q: 1 } });
    b.pushToolResult("c1", "结果", false);

    const blocks = b.blocks();
    const restored = parseBlocks(serializeBlocks(blocks));

    expect(restored.map((x) => x.kind)).toEqual(["thinking", "text", "tool"]);
  });

  it("工具结果过长时截断（防止单条记录膨胀）", () => {
    const b = new BlockBuilder();
    b.pushToolCall({ id: "c1", name: "搜索", args: {} });
    b.pushToolResult("c1", "x".repeat(5000), false);

    const raw = serializeBlocks(b.blocks());
    const restored = parseBlocks(raw);

    const tool = restored[0];
    if (tool.kind !== "tool") throw new Error("应当是工具块");
    expect(tool.call.result?.length).toBeLessThan(5000);
    expect(tool.call.result).toContain("已截断");
  });

  it("结构不对时当作没有（不让整个历史读取失败）", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
    expect(parseBlocks("{不是 JSON")).toEqual([]);
    expect(parseBlocks('{"kind":"text"}')).toEqual([]);
  });

  it("空块序列化成空串", () => {
    expect(serializeBlocks([])).toBe("");
  });
});
