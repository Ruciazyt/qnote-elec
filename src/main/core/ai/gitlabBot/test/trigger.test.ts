// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const configState: { current: any } = { current: null };

vi.mock("electron", () => ({
  app: { getPath: () => ".data" },
}));

vi.mock("../config/configStore", () => ({
  getGitlabBotConfig: () => configState.current,
}));

vi.mock("../../tools/gitlab/runtime/config", () => ({
  getGitlabConfig: () => ({ baseUrl: "", token: "" }),
}));

vi.mock("../task/task", () => ({
  runGitlabTask: vi.fn(async () => ({ ok: true, text: "" })),
}));

import { GitlabBotTrigger } from "../events/trigger";
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

});
