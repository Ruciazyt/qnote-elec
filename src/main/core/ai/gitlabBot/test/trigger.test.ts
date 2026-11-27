// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const configState: { current: any } = { current: null };

vi.mock("electron", () => ({
  app: { getPath: () => ".data" },
}));

vi.mock("../configStore", () => ({
  getGitlabBotConfig: () => configState.current,
}));

vi.mock("../tools/gitlab/runtime/config", () => ({
  getGitlabConfig: () => ({ baseUrl: "", token: "" }),
}));

vi.mock("./task", () => ({
  runGitlabTask: vi.fn(async () => ({ ok: true, text: "" })),
}));

import { GitlabBotTrigger } from "../trigger";
import { log } from "../../../system/log";

function noteEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventType: "Note Hook",
    objectKind: "note",
    projectId: 7,
    projectPath: "team/app",
    defaultBranch: "main",
    labels: [],
    comment: "@qnote 修一下这个白屏",
    author: "alice",
    noteId: 99,
    issueIid: 12,
    title: "登录页报错",
    ...overrides,
  } as any;
}

beforeEach(() => {
  configState.current = {
    enabled: true,
    port: 7799,
    bindAddress: "0.0.0.0",
    signingToken: "",
    secretToken: "s3cret",
    relayToken: "",
    triggerWords: ["@qnote"],
    allowedProjects: [],
  };
});

describe("GitLab 事件接收", () => {
  it("收到消息时打印一条控制台记录", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const trigger = new GitlabBotTrigger({});

    trigger.enqueue(noteEvent());

    expect(info).toHaveBeenCalledWith(
      "[gitlab-bot] 收到 GitLab 消息",
      expect.objectContaining({
        source: "relay",
        project: "team/app",
        kind: "note",
        event: "Note Hook",
        author: "alice",
        target: "issue#12 note#99",
        comment: "@qnote 修一下这个白屏",
      })
    );
    info.mockRestore();
  });

  it("webhook 通道的记录标出来源是 webhook", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const trigger = new GitlabBotTrigger({});

    await trigger.handle("Note Hook", {
      object_kind: "note",
      project: {
        id: 7,
        path_with_namespace: "team/app",
        default_branch: "main",
      },
      user: { username: "alice" },
      issue: { iid: 12, title: "登录页报错", description: "" },
      object_attributes: {
        id: 99,
        note: "@qnote 修一下这个白屏",
        noteable_type: "Issue",
      },
    });

    expect(info).toHaveBeenCalledWith(
      "[gitlab-bot] 收到 GitLab 消息",
      expect.objectContaining({ source: "webhook", project: "team/app" })
    );
    info.mockRestore();
  });
});
