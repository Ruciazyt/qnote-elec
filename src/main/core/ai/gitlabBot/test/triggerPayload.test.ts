// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("../../tools/gitlab/api/client", () => ({
  gitlabRequest: (options: unknown) => requestMock(options),
}));

import { loadTriggerPayload } from "../triggerPayload";

beforeEach(() => {
  requestMock.mockReset();
});

describe("从 GitLab 取 trigger 报文", () => {
  it("读出 TRIGGER_PAYLOAD 并解析成对象", async () => {
    requestMock.mockResolvedValue({
      data: [
        { key: "TRIGGER_PAYLOAD", value: '{"object_kind":"note","n":1}' },
        { key: "OTHER", value: "x" },
      ],
    });
    const result = await loadTriggerPayload({
      projectId: 93599,
      pipelineId: 1675465,
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ object_kind: "note", n: 1 });
    expect(requestMock.mock.calls[0][0].path).toBe(
      "/projects/93599/pipelines/1675465/variables"
    );
  });

  it("没有该变量时报错", async () => {
    requestMock.mockResolvedValue({ data: [] });
    const result = await loadTriggerPayload({
      projectId: 93599,
      pipelineId: 1675465,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("TRIGGER_PAYLOAD");
  });

  it("报文不是合法 JSON 时报错", async () => {
    requestMock.mockResolvedValue({
      data: [{ key: "TRIGGER_PAYLOAD", value: "不是 JSON" }],
    });
    const result = await loadTriggerPayload({
      projectId: 93599,
      pipelineId: 1675465,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("JSON");
  });

  it("请求失败时把错误带出来", async () => {
    requestMock.mockRejectedValue(new Error("404 找不到"));
    const result = await loadTriggerPayload({
      projectId: 93599,
      pipelineId: 1675465,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("404");
  });
});
