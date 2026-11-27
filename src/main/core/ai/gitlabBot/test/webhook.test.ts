// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decideTrigger,
  findTriggerWord,
  parseGitlabEvent,
  stripTriggerWord,
} from "../webhook";
import type { GitlabBotConfig } from "../configStore";

const BASE_CONFIG: GitlabBotConfig = {
  enabled: true,
  port: 7799,
  bindAddress: "0.0.0.0",
  signingToken: "",
  secretToken: "s3cret",
  relayToken: "",
  triggerWords: ["@qnote"],
  allowedProjects: [],
};

function notePayload(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    object_kind: "note",
    project: {
      id: 7,
      path_with_namespace: "team/app",
      default_branch: "main",
      http_url_to_repo: "https://gitlab.example.com/team/app.git",
    },
    user: { username: "alice" },
    issue: {
      iid: 12,
      title: "登录页报错",
      description: "点登录就白屏",
      labels: ["bug"],
      web_url: "https://gitlab.example.com/team/app/-/issues/12",
    },
    object_attributes: {
      id: 99,
      note: "@qnote 修一下这个白屏",
      noteable_type: "Issue",
    },
    ...overrides,
  };
}

describe("GitLab webhook 解析", () => {
  it("从 Note Hook 里取出项目、issue 与评论", () => {
    const event = parseGitlabEvent("Note Hook", notePayload());
    expect(event).not.toBeNull();
    expect(event!.projectPath).toBe("team/app");
    expect(event!.issueIid).toBe(12);
    expect(event!.comment).toBe("@qnote 修一下这个白屏");
    expect(event!.author).toBe("alice");
    expect(event!.defaultBranch).toBe("main");
    expect(event!.repoUrl).toBe("https://gitlab.example.com/team/app.git");
    expect(event!.labels).toEqual(["bug"]);
  });

  it("合并请求评论记成 mr 而不是 issue", () => {
    const event = parseGitlabEvent(
      "Note Hook",
      notePayload({
        issue: undefined,
        merge_request: { iid: 5, title: "改登录", description: "" },
        object_attributes: { note: "@qnote 看看", noteable_type: "MergeRequest" },
      })
    );
    expect(event!.mrIid).toBe(5);
    expect(event!.issueIid).toBeUndefined();
  });

  it("合并请求事件取源分支与动作", () => {
    const event = parseGitlabEvent("Merge Request Hook", {
      object_kind: "merge_request",
      project: { id: 7, path_with_namespace: "team/app" },
      user: { username: "bob" },
      object_attributes: {
        iid: 9,
        title: "加登录",
        description: "",
        source_branch: "feature/login",
        target_branch: "main",
        action: "open",
      },
    });
    expect(event!.mrIid).toBe(9);
    expect(event!.branch).toBe("feature/login");
    expect(event!.action).toBe("open");
  });

  it("报文里没有项目就解析不出来", () => {
    expect(parseGitlabEvent("Note Hook", { object_kind: "note" })).toBeNull();
    expect(parseGitlabEvent("Note Hook", null)).toBeNull();
  });
});

describe("触发判定", () => {
  it("网关没启用就不触发", () => {
    const event = parseGitlabEvent("Note Hook", notePayload())!;
    const decision = decideTrigger(event, { ...BASE_CONFIG, enabled: false });
    expect(decision.ok).toBe(false);
  });

  it("没配密钥就不触发", () => {
    const event = parseGitlabEvent("Note Hook", notePayload())!;
    const decision = decideTrigger(event, {
      ...BASE_CONFIG,
      secretToken: "",
      signingToken: "",
    });
    expect(decision.ok).toBe(false);
  });

  it("只配签名密钥也能触发", () => {
    const event = parseGitlabEvent("Note Hook", notePayload())!;
    const decision = decideTrigger(event, {
      ...BASE_CONFIG,
      secretToken: "",
      signingToken: "whsec_abc",
    });
    expect(decision.ok).toBe(true);
    expect(decision.instruction).toBe("修一下这个白屏");
  });

  it("项目不在允许列表里就不触发", () => {
    const event = parseGitlabEvent("Note Hook", notePayload())!;
    const decision = decideTrigger(event, {
      ...BASE_CONFIG,
      allowedProjects: ["other/app"],
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("team/app");
  });

  it("不在允许列表里的项目放行", () => {
    const event = parseGitlabEvent("Note Hook", notePayload())!;
    const decision = decideTrigger(event, {
      ...BASE_CONFIG,
      allowedProjects: ["team/app"],
    });
    expect(decision.ok).toBe(true);
  });

  it("不支持的事件类型不触发", () => {
    const event = parseGitlabEvent("Push Hook", {
      object_kind: "push",
      project: { id: 7, path_with_namespace: "team/app" },
      ref: "refs/heads/main",
    })!;
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("Push Hook");
  });

  it("没命中触发词就不触发", () => {
    const event = parseGitlabEvent(
      "Note Hook",
      notePayload({
        object_attributes: {
          id: 99,
          note: "这个我先看看",
          noteable_type: "Issue",
        },
      })
    )!;
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(false);
  });

  it("命中触发词就触发并抽出指令", () => {
    const event = parseGitlabEvent("Note Hook", notePayload())!;
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(true);
    expect(decision.instruction).toBe("修一下这个白屏");
  });

  it("触发词后面没内容就不触发", () => {
    const event = parseGitlabEvent(
      "Note Hook",
      notePayload({
        object_attributes: {
          id: 99,
          note: "@qnote",
          noteable_type: "Issue",
        },
      })
    )!;
    const decision = decideTrigger(event, BASE_CONFIG);
    expect(decision.ok).toBe(false);
  });

  it("issue 标题里带触发词也算触发", () => {
    const event = parseGitlabEvent("Issue Hook", {
      object_kind: "issue",
      project: { id: 7, path_with_namespace: "team/app" },
      user: { username: "carol" },
      issue: { iid: 3, title: "@qnote 帮我看看这个", description: "" },
    })!;
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
