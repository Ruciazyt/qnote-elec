// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decideTrigger,
  findTriggerWord,
  stripTriggerWord,
} from "../events/webhook";
import type { GitlabEvent } from "../events/webhook";
import type { GitlabBotConfig } from "../config/configStore";

const BASE_CONFIG: GitlabBotConfig = {
  enabled: true,
  port: 7799,
  relayToken: "",
  triggerWords: ["@qnote"],
  allowedProjects: [],
};

function noteEvent(overrides: Partial<GitlabEvent> = {}): GitlabEvent {
  return {
    eventType: "Note Hook",
    objectKind: "note",
    projectId: 7,
    projectPath: "team/app",
    defaultBranch: "main",
    repoUrl: "https://gitlab.example.com/team/app.git",
    issueIid: 12,
    title: "登录页报错",
    description: "点登录就白屏",
    labels: ["bug"],
    comment: "@qnote 修一下这个白屏",
    author: "alice",
    noteId: 99,
    objectId: 99,
    ...overrides,
  };
}

describe("触发判定", () => {
  it("网关没启用就不触发", () => {
    const event = noteEvent();
    const decision = decideTrigger(event, { ...BASE_CONFIG, enabled: false });
    expect(decision.ok).toBe(false);
  });

  it("项目不在允许列表里就不触发", () => {
    const event = noteEvent();
    const decision = decideTrigger(event, {
      ...BASE_CONFIG,
      allowedProjects: ["other/app"],
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("team/app");
  });

  it("不在允许列表里的项目放行", () => {
    const event = noteEvent();
    const decision = decideTrigger(event, {
      ...BASE_CONFIG,
      allowedProjects: ["team/app"],
    });
    expect(decision.ok).toBe(true);
  });

  it("不支持的事件类型不触发", () => {
    const event = noteEvent({
      eventType: "Push Hook",
      objectKind: "push",
    });
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("Push Hook");
  });

  it("没命中触发词就不触发", () => {
    const event = noteEvent({ comment: "这个我先看看" });
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(false);
  });

  it("命中触发词就触发并抽出指令", () => {
    const event = noteEvent();
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(true);
    expect(decision.instruction).toBe("修一下这个白屏");
  });

  it("触发词后面没内容就不触发", () => {
    const event = noteEvent({ comment: "@qnote" });
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(false);
  });

  it("触发词在标题里、评论没带触发词时不触发", () => {
    const event = noteEvent({
      title: "@qnote 帮我看看这个",
      comment: "我也遇到了",
    });
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(false);
  });

  it("issue 标题里带触发词也算触发", () => {
    const event = noteEvent({
      eventType: "Issue Hook",
      objectKind: "issue",
      issueIid: 3,
      comment: undefined,
      title: "@qnote 帮我看看这个",
    });
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(true);
    expect(decision.instruction).toContain("帮我看看这个");
  });
});

describe("触发词匹配", () => {
  it("大小写不敏感", () => {
    expect(findTriggerWord("请 @QNOTE 处理", ["@qnote"])).toBe("@qnote");
  });

  it("去掉触发词只留指令", () => {
    expect(stripTriggerWord("@qnote 修一下", "@qnote")).toBe(" 修一下");
  });
});
