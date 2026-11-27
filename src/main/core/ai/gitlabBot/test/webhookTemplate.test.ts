// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildWebhookTemplate,
  buildWebhookUrl,
  maskWebhookSecret,
  resolveLanAddress,
  GITLAB_WEBHOOK_DEFAULT_EVENTS,
} from "../webhookTemplate";

describe("GitLab webhook 模板", () => {
  it("默认只开 issue / 合并请求 / 评论三类事件", () => {
    const template = buildWebhookTemplate({
      port: 7799,
      secretToken: "secret-token",
      // eslint-disable-next-line sonarjs/no-hardcoded-ip -- 用例里的示例内网地址
      host: "192.168.1.20", // NOSONAR
    });
    // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言内网 http 地址
    expect(template.url).toBe("http://192.168.1.20:7799/gitlab/webhook"); // NOSONAR
    expect(template.token).toBe("secret-token");
    expect(template.note_events).toBe(true);
    expect(template.issues_events).toBe(true);
    expect(template.merge_requests_events).toBe(true);
    expect(template.push_events).toBe(false);
    expect(template.pipeline_events).toBe(false);
    expect(template.enable_ssl_verification).toBe(false);
  });

  it("调用方可以覆盖事件开关", () => {
    const template = buildWebhookTemplate({
      port: 7799,
      secretToken: "t",
      // eslint-disable-next-line sonarjs/no-hardcoded-ip -- 用例里的示例内网地址
      host: "10.0.0.5", // NOSONAR
      events: { push_events: true, note_events: false },
    });
    expect(template.push_events).toBe(true);
    expect(template.note_events).toBe(false);
    expect(GITLAB_WEBHOOK_DEFAULT_EVENTS.note_events).toBe(true);
  });

  it("监听 0.0.0.0 时换成内网地址", () => {
    const url = buildWebhookUrl(7799, "0.0.0.0");
    expect(url).toBe(`http://${resolveLanAddress()}:7799/gitlab/webhook`);
    expect(url).not.toContain("0.0.0.0");
  });

  it("没给密钥就不带 token 字段", () => {
    const template = buildWebhookTemplate({ port: 7799, secretToken: "", host: "127.0.0.1" });
    expect(template.token).toBeUndefined();
  });

  it("签名密钥进模板的 signing_token 字段", () => {
    const template = buildWebhookTemplate({
      port: 7799,
      secretToken: "",
      signingToken: "whsec_abc",
      host: "127.0.0.1",
    });
    expect(template.signing_token).toBe("whsec_abc");
    expect(template.token).toBeUndefined();
  });

  it("签名密钥与明文令牌可以同时给", () => {
    const template = buildWebhookTemplate({
      port: 7799,
      secretToken: "plain",
      signingToken: "whsec_abc",
      host: "127.0.0.1",
    });
    expect(template.token).toBe("plain");
    expect(template.signing_token).toBe("whsec_abc");
  });

  it("密钥打码", () => {
    expect(maskWebhookSecret("abcdefghijkl")).toBe("abcd******ijkl");
    expect(maskWebhookSecret("")).toBe("");
  });
});
