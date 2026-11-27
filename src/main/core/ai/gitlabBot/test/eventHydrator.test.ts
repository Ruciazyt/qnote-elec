// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("../../tools/gitlab/api/client", () => ({
  gitlabRequest: (options: unknown) => requestMock(options),
}));

import {
  hydrateTriggerPointer,
  resolveEventPayload,
} from "../eventHydrator";
import { parseTriggerPointer } from "../triggerPointer";

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

describe("按指针回源取原文", () => {
  it("评论落在 issue 上时补出评论正文与 issue", async () => {
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

    const pointer = parseTriggerPointer(ISSUE_NOTE_POINTER)!;
    const result = await hydrateTriggerPointer(pointer);
    expect(result.ok).toBe(true);
    expect(result.payload?.object_attributes).toMatchObject({
      note: "@qnote 修一下登录",
      noteable_type: "Issue",
    });
    expect(result.payload?.issue).toMatchObject({ iid: 3, title: "登录页报错" });
    expect(requestMock.mock.calls[0][0].path).toBe("/projects/93599/issues/3");
    expect(requestMock.mock.calls[1][0].path).toBe(
      "/projects/93599/issues/3/notes/9463460"
    );
  });

  it("评论落在合并请求上时补出合并请求", async () => {
    requestMock
      .mockResolvedValueOnce({
        data: { iid: 4, title: "改登录", description: "", source_branch: "f/x" },
      })
      .mockResolvedValueOnce({
        data: { id: 9463461, body: "@qnote 看看", author: { username: "bob" } },
      });

    const pointer = parseTriggerPointer({
      ...ISSUE_NOTE_POINTER,
      noteable_type: "MergeRequest",
      object_id: "9463461",
      mr_iid: "4",
    })!;
    const result = await hydrateTriggerPointer(pointer);
    expect(result.ok).toBe(true);
    expect(result.payload?.merge_request).toMatchObject({ iid: 4 });
    expect(result.payload?.user).toEqual({ username: "bob" });
    expect(requestMock.mock.calls[1][0].path).toBe(
      "/projects/93599/merge_requests/4/notes/9463461"
    );
  });

  it("issue 事件按 iid 取详情", async () => {
    requestMock.mockResolvedValueOnce({
      data: { iid: 3, title: "标题", description: "正文" },
    });
    const pointer = parseTriggerPointer({
      object_kind: "issue",
      event_type: "issue",
      project_id: "93599",
      project_path: "zhuyt9/demo",
      default_branch: "main",
      author: "zhuyt9",
      object_id: "47082",
      object_iid: "3",
    })!;
    const result = await hydrateTriggerPointer(pointer);
    expect(result.ok).toBe(true);
    expect(result.payload?.issue).toMatchObject({ iid: 3, title: "标题" });
  });

  it("接口报错时带回原因", async () => {
    requestMock.mockRejectedValue(new Error("404 找不到"));
    const pointer = parseTriggerPointer(ISSUE_NOTE_POINTER)!;
    const result = await hydrateTriggerPointer(pointer);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("404");
  });
});

describe("报文归一", () => {
  it("标准报文原样透传", async () => {
    const payload = {
      object_kind: "note",
      object_attributes: { note: "@qnote 干活" },
    };
    const result = await resolveEventPayload(payload);
    expect(result.ok).toBe(true);
    expect(result.payload).toBe(payload);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("指针报文回源后补齐", async () => {
    requestMock
      .mockResolvedValueOnce({ data: { iid: 3, title: "t" } })
      .mockResolvedValueOnce({ data: { id: 9463460, body: "@qnote 干活" } });
    const result = await resolveEventPayload(ISSUE_NOTE_POINTER);
    expect(result.ok).toBe(true);
    expect(result.payload?.object_attributes).toMatchObject({
      note: "@qnote 干活",
    });
  });
});
