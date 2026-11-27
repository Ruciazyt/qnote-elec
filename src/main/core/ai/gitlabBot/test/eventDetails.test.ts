// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("../../tools/gitlab/api/client", () => ({
  gitlabGet: async (path: string) =>
    (await requestMock({ method: "GET", path, idempotent: true })).data,
}));

import { getGitlabEvent } from "../events/eventDetails";

const ISSUE_NOTE_POINTER = {
  object_kind: "note",
  event_type: "note",
  project_id: "93599",
  project_path: "zhuyt9/demo",
  default_branch: "main",
  author: "zhuyt9",
  object_id: "9463460",
  object_iid: "null",
  noteable_type: "Issue",
  noteable_id: "47082",
  issue_iid: "3",
  mr_iid: "null",
};

beforeEach(() => {
  requestMock.mockReset();
});

describe("指针直接转换成 GitLab 事件", () => {
  it("评论落在 issue 上时回源并生成事件", async () => {
    requestMock
      .mockResolvedValueOnce({
        data: {
          iid: 3,
          title: "登录页报错",
          description: "描述",
          labels: ["bug"],
          web_url: "https://gitlab.example.com/zhuyt9/demo/-/issues/3",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: 9463460,
          body: "@qnote 修一下登录",
          author: { username: "zhuyt9" },
        },
      });

    const result = await getGitlabEvent("Note Hook", ISSUE_NOTE_POINTER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event).toMatchObject({
        eventType: "Note Hook",
        objectKind: "note",
        comment: "@qnote 修一下登录",
        noteId: 9463460,
        issueIid: 3,
        title: "登录页报错",
        labels: ["bug"],
      });
    }
    expect(requestMock.mock.calls[0][0].path).toBe("/projects/93599/issues/3");
    expect(requestMock.mock.calls[1][0].path).toBe(
      "/projects/93599/issues/3/notes/9463460"
    );
  });

  it("评论落在合并请求上时回源并生成事件", async () => {
    requestMock
      .mockResolvedValueOnce({
        data: { iid: 4, title: "改登录", description: "", source_branch: "f/x" },
      })
      .mockResolvedValueOnce({
        data: { id: 9463461, body: "@qnote 看看", author: { username: "bob" } },
      });

    const pointer = {
      ...ISSUE_NOTE_POINTER,
      noteable_type: "MergeRequest",
      object_id: "9463461",
      mr_iid: "4",
    };
    const result = await getGitlabEvent("Note Hook", pointer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event).toMatchObject({
        mrIid: 4,
        title: "改登录",
        author: "bob",
      });
    }
    expect(requestMock.mock.calls[1][0].path).toBe(
      "/projects/93599/merge_requests/4/notes/9463461"
    );
  });

  it("issue 事件按 iid 取详情", async () => {
    requestMock.mockResolvedValueOnce({
      data: { iid: 3, title: "标题", description: "正文" },
    });
    const pointer = {
      object_kind: "issue",
      event_type: "issue",
      project_id: "93599",
      project_path: "zhuyt9/demo",
      default_branch: "main",
      author: "zhuyt9",
      object_id: "47082",
      object_iid: "3",
    };
    const result = await getGitlabEvent("Issue Hook", pointer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event).toMatchObject({
        issueIid: 3,
        title: "标题",
        description: "正文",
        action: "open",
      });
    }
  });

  it("接口报错时带回原因", async () => {
    requestMock.mockRejectedValue(new Error("404 找不到"));
    const result = await getGitlabEvent("Note Hook", ISSUE_NOTE_POINTER);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.stage).toBe("detail");
      expect(result.reason).toContain("404");
    }
  });
});

describe("指针事件转换", () => {
  it("拒绝完整 webhook 报文", async () => {
    const result = await getGitlabEvent("Note Hook", {
      object_kind: "note",
      project: { id: 93599, path_with_namespace: "zhuyt9/demo" },
      object_attributes: { id: 9463460, note: "@qnote 干活" },
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "parse",
      reason: "GitLab 指针报文无效",
    });
  });

  it("从指针报文回源并直接转换成事件", async () => {
    requestMock
      .mockResolvedValueOnce({ data: { iid: 3, title: "t" } })
      .mockResolvedValueOnce({ data: { id: 9463460, body: "@qnote 干活" } });
    const result = await getGitlabEvent("Note Hook", ISSUE_NOTE_POINTER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.comment).toBe("@qnote 干活");
  });
});
