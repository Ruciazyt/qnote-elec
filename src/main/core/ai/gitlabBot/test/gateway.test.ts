// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configState: { current: any } = { current: null };

vi.mock("../config/configStore", () => ({
  getGitlabBotConfig: () => configState.current,
}));

import { gitlabGatewayStatusTool } from "../../tools/gitlab/tools/gateway";

beforeEach(() => {
  configState.current = {
    enabled: true,
    port: 7799,
    relayToken: "qnrelay_abcdefghijkl",
    triggerWords: ["@qnote"],
    allowedProjects: ["team/app"],
  };
});

afterEach(() => {
  configState.current = null;
});

describe("GitLab 网关配置读取", () => {
  it("返回 Relay 地址与触发配置", async () => {
    const result = await gitlabGatewayStatusTool.invoke({});
    expect(result.enabled).toBe(true);
    expect(result.relay_url).toBe("http://127.0.0.1:7799/gitlab/relay");
    expect(result.relay_ready).toBe(true);
    expect(result.trigger_words).toEqual(["@qnote"]);
    expect(result.allowed_projects).toEqual(["team/app"]);
    expect(JSON.stringify(result)).not.toContain("qnrelay_abcdefghijkl");
  });
});
