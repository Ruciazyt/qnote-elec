// @vitest-environment node
import { describe, it, expect } from "vitest";
import { splitThinkContent } from "./thinkContent";

/**
 * 推理块与正文的拆分
 *
 * 模型把推理过程混在正文里一起返回，界面要把「想」和「答」分开显示。
 * 最难的是流式输出：`<think>` 可能只到了一半（"<thi"），
 * 这时候不能把半个标签当正文写出去 —— 整段推理就再也识别不出来了。
 *
 * 纯逻辑，不碰文件系统。
 */

describe("splitThinkContent", () => {
  it("没有推理块时全文都是答案", () => {
    const result = splitThinkContent("这是一条普通回答");

    expect(result.hasThinkBlock).toBe(false);
    expect(result.isThinking).toBe(false);
    expect(result.answer).toBe("这是一条普通回答");
    expect(result.thought).toBe("");
  });

  it("有闭合的推理块时拆成答案与思考", () => {
    const result = splitThinkContent("<think>我在想</think>这是答案");

    expect(result.hasThinkBlock).toBe(true);
    expect(result.isThinking).toBe(false);
    expect(result.answer).toBe("这是答案");
    expect(result.thought).toBe("我在想");
  });

  it("推理块在中间也能拆开", () => {
    const result = splitThinkContent("前面<think>想</think>后面");

    expect(result.answer).toBe("前面后面");
    expect(result.thought).toBe("想");
  });

  it("标签大小写不敏感", () => {
    const result = splitThinkContent("<THINK>想</THINK>答");

    expect(result.thought).toBe("想");
    expect(result.answer).toBe("答");
  });

  it("推理块还没闭合时标记为仍在思考", () => {
    const result = splitThinkContent("<think>想了一半");

    expect(result.hasThinkBlock).toBe(true);
    expect(result.isThinking).toBe(true);
    expect(result.thought).toBe("想了一半");
  });

  it("结尾的半个标签不被当正文（流式输出的常态）", () => {
    const result = splitThinkContent("答案<thi");

    expect(result.answer).toBe("答案");
    expect(result.hasThinkBlock).toBe(false);
  });

  it("多个推理块合并成一段思考", () => {
    const result = splitThinkContent("<think>一</think>中间<think>二</think>结尾");

    expect(result.thought).toBe("一\n\n二");
    expect(result.answer).toBe("中间结尾");
  });

  it("空内容不报错", () => {
    const result = splitThinkContent("");

    expect(result.answer).toBe("");
    expect(result.thought).toBe("");
    expect(result.hasThinkBlock).toBe(false);
  });
});
