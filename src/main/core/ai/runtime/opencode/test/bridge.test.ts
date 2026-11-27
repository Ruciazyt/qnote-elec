// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildOpencodeParts, toOpencodeProvider } from "../bridge";

describe("opencode provider 映射", () => {
  it("OpenAI 兼容走 openai-compatible", () => {
    const provider = toOpencodeProvider({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.example.com/v1/chat/completions",
    });
    expect(provider.id).toBe("qnote");
    expect(provider.npm).toBe("@ai-sdk/openai-compatible");
    expect(provider.baseURL).toBe("https://api.example.com/v1");
    expect(provider.model).toBe("gpt-4o-mini");
    expect(provider.apiKey).toBe("sk-test");
  });

  it("deepseek 按 OpenAI 兼容处理", () => {
    const provider = toOpencodeProvider({
      provider: "deepseek",
      apiKey: "sk-test",
      model: "deepseek-chat",
    });
    expect(provider.npm).toBe("@ai-sdk/openai-compatible");
    expect(provider.baseURL).toBeUndefined();
  });

  it("claude 走 anthropic 并剥掉 /v1/messages", () => {
    const provider = toOpencodeProvider({
      provider: "claude",
      apiKey: "sk-ant",
      model: "claude-3-5-haiku-20241022",
      baseUrl: "https://api.anthropic.com/v1/messages",
    });
    expect(provider.npm).toBe("@ai-sdk/anthropic");
    expect(provider.baseURL).toBe("https://api.anthropic.com");
  });

  it("没填模型时用默认模型", () => {
    const provider = toOpencodeProvider({
      provider: "openai",
      apiKey: "sk-test",
      model: "",
    });
    expect(provider.model).toBe("gpt-4o-mini");
  });
});

describe("opencode 消息拼装", () => {
  it("记忆、技能、图片、用户输入按顺序进 parts", () => {
    const parts = buildOpencodeParts({
      message: "帮我看下待办",
      memoryBlock: "记忆片段",
      skillMessages: [{ role: "system", content: "技能说明" }],
      images: [{ mime: "image/png", data: "AAAA" }],
    });
    expect(parts.map((p) => p.type)).toEqual(["text", "text", "file", "text"]);
    expect(parts[0].type === "text" && parts[0].text).toBe("记忆片段");
    expect(parts[1].type === "text" && parts[1].text).toBe("技能说明");
    expect(parts[2].type === "file" && parts[2].mime).toBe("image/png");
    expect(parts[2].type === "file" && parts[2].url).toBe("data:image/png;base64,AAAA");
    expect(parts[3].type === "text" && parts[3].text).toBe("帮我看下待办");
  });

  it("没有图片与记忆时只发用户输入", () => {
    const parts = buildOpencodeParts({ message: "在吗" });
    expect(parts).toHaveLength(1);
    expect(parts[0].type === "text" && parts[0].text).toBe("在吗");
  });
});
