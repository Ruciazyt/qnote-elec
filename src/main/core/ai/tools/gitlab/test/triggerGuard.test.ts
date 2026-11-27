// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { setGitlabTriggerWords } from "../runtime/triggerWords";
import { guardBotContent, stripTriggerWords } from "../utils/triggerGuard";

beforeEach(() => {
  setGitlabTriggerWords(["@qnote"]);
});

describe("触发词剥离", () => {
  it("把触发词从正文里去掉", () => {
    const result = stripTriggerWords("@qnote 帮我改一下", ["@qnote"]);
    expect(result.text).toBe("帮我改一下");
    expect(result.removed).toEqual(["@qnote"]);
  });

  it("大小写不敏感", () => {
    const result = stripTriggerWords("请 @QNOTE 处理", ["@qnote"]);
    expect(result.text).toBe("请 处理");
    expect(result.removed).toEqual(["@qnote"]);
  });

  it("正文中间的触发词也能去掉", () => {
    const result = stripTriggerWords("已按 @qnote 的要求完成", ["@qnote"]);
    expect(result.text).toBe("已按 的要求完成");
  });

  it("没有触发词就原样返回", () => {
    const result = stripTriggerWords("普通说明", ["@qnote"]);
    expect(result.text).toBe("普通说明");
    expect(result.removed).toEqual([]);
  });

  it("多个触发词都能去掉", () => {
    const result = stripTriggerWords("@qnote 和 @bot 都要处理", ["@qnote", "@bot"]);
    expect(result.removed).toEqual(["@qnote", "@bot"]);
    expect(result.text).not.toContain("@qnote");
    expect(result.text).not.toContain("@bot");
  });
});

describe("发送前检查", () => {
  it("不含触发词时原样放行", () => {
    const guarded = guardBotContent("改完了，麻烦看一眼", "评论");
    expect(guarded.blocked).toBe(false);
    expect(guarded.text).toBe("改完了，麻烦看一眼");
    expect(guarded.removed).toEqual([]);
  });

  it("含触发词时剥离后放行", () => {
    const guarded = guardBotContent("已按 @qnote 的要求改完", "评论");
    expect(guarded.blocked).toBe(false);
    expect(guarded.text).not.toContain("@qnote");
    expect(guarded.removed).toEqual(["@qnote"]);
  });

  it("只有触发词时直接拦截", () => {
    const guarded = guardBotContent("@qnote", "评论");
    expect(guarded.blocked).toBe(true);
    expect(guarded.message).toContain("触发词");
  });

  it("词表为空时用默认触发词", () => {
    setGitlabTriggerWords([]);
    const guarded = guardBotContent("@qnote 做事", "评论");
    expect(guarded.removed).toEqual(["@qnote"]);
  });
});
