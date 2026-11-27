// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configState: { current: any } = { current: null };

vi.mock("../config/configStore", () => ({
  getGitlabBotConfig: () => configState.current,
}));

import {
  authorizeRelay,
  generateRelayToken,
  parseRelayRequest,
  RELAY_TOKEN_PREFIX,
} from "../gateway/relay";

const RELAY_TOKEN = "qnrelay_test_token";

beforeEach(() => {
  configState.current = {
    enabled: true,
    port: 7799,
    relayToken: RELAY_TOKEN,
    triggerWords: ["@qnote"],
    allowedProjects: [],
  };
});

afterEach(() => {
  configState.current = null;
});

describe("relay 令牌", () => {
  it("生成的令牌带固定前缀", () => {
    const token = generateRelayToken();
    expect(token.startsWith(RELAY_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(RELAY_TOKEN_PREFIX.length + 10);
  });

  it("令牌匹配才放行", () => {
    expect(authorizeRelay(RELAY_TOKEN).ok).toBe(true);
    expect(authorizeRelay("wrong").ok).toBe(false);
    expect(authorizeRelay("").ok).toBe(false);
  });

  it("没配 relay 令牌时一律拒绝", () => {
    configState.current.relayToken = "";
    const result = authorizeRelay(RELAY_TOKEN);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("没配");
  });
});

describe("relay 报文解析", () => {
  it("取头里的令牌与事件类型", () => {
    const request = parseRelayRequest({
      token: "abc",
      eventType: "Note Hook",
      payload: { a: 1 },
    });
    expect(request.token).toBe("abc");
    expect(request.eventType).toBe("Note Hook");
    expect(request.payload).toEqual({ a: 1 });
  });

  it("带出 pipeline id 与项目 id", () => {
    const request = parseRelayRequest({
      token: "abc",
      eventType: "",
      payload: undefined,
      projectId: "93599",
      pipelineId: "1675465",
    });
    expect(request.projectId).toBe(93599);
    expect(request.pipelineId).toBe(1675465);
  });

  it("id 不是正整数时忽略", () => {
    const request = parseRelayRequest({
      token: "abc",
      eventType: "",
      payload: undefined,
      projectId: "0",
      pipelineId: "abc",
    });
    expect(request.projectId).toBeUndefined();
    expect(request.pipelineId).toBeUndefined();
  });
});
