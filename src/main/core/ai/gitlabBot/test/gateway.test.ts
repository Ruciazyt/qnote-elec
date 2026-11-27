// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configState: { current: any } = { current: null };

vi.mock("../configStore", () => ({
  getGitlabBotConfig: () => configState.current,
}));

import { gitlabGatewayStatusTool } from "../../tools/gitlab/tools/gateway";

beforeEach(() => {
  configState.current = {
    enabled: true,
    port: 7799,
    bindAddress: "0.0.0.0",
    signingToken: "whsec_abcdefghijkl",
    secretToken: "",
    relayToken: "qnrelay_abcdefghijkl",
    triggerWords: ["@qnote"],
    allowedProjects: ["team/app"],
  };
});

afterEach(() => {
  configState.current = null;
});

describe("GitLab 网关配置读取", () => {
  it("返回 webhook 地址与触发词", async () => {
    const result = await gitlabGatewayStatusTool.invoke({});
    expect(result.enabled).toBe(true);
    expect(result.webhook_url).toContain(":7799/gitlab/webhook");
    expect(result.trigger_words).toEqual(["@qnote"]);
    expect(result.allowed_projects).toEqual(["team/app"]);
  });

  it("签名模式下模式是 signing 且不泄露明文密钥", async () => {
    const result = await gitlabGatewayStatusTool.invoke({});
    expect(result.mode).toBe("signing");
    expect(result.signing_token_hint).toContain("******");
    expect(JSON.stringify(result)).not.toContain("whsec_abcdefghijkl");
  });

  it("只配明文令牌时模式是 plaintext", async () => {
    configState.current.signingToken = "";
    configState.current.secretToken = "plain-secret-value";
    const result = await gitlabGatewayStatusTool.invoke({});
    expect(result.mode).toBe("plaintext");
    expect(JSON.stringify(result)).not.toContain("plain-secret-value");
  });

  it("两个密钥都没配时模式是 none", async () => {
    configState.current.signingToken = "";
    const result = await gitlabGatewayStatusTool.invoke({});
    expect(result.mode).toBe("none");
    expect(result.signing_token_hint).toBe("");
    expect(result.secret_token_hint).toBe("");
  });

  it("绑定具体地址时用该地址而不是内网地址", async () => {
    configState.current.bindAddress = "127.0.0.1";
    const result = await gitlabGatewayStatusTool.invoke({});
    expect(result.webhook_url).toBe("http://127.0.0.1:7799/gitlab/webhook");
  });
});
