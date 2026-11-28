import { describe, it, expect } from "vitest";
import {
  checkPublishCompatibility,
  findIpLiteralIssues,
  findIpLiteralUrl,
  isIpLiteralHost,
} from "./publishCheck";

function manifestOf(runtime: unknown, capabilities?: unknown): string {
  return JSON.stringify({
    id: "local.demo",
    name: "示例",
    version: "1.0.0",
    publisher: "local",
    engines: { qnote: "^2.0.0" },
    runtime,
    capabilities,
  });
}

describe("IP 字面量识别", () => {
  it("带 scheme 的 IPv4 是 IP 字面量", () => {
    expect(isIpLiteralHost("127.0.0.1")).toBe(true);
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- 用例就是要断言 IP 字面量被认出来
    expect(isIpLiteralHost("10.0.0.1")).toBe(true); // NOSONAR
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- 用例就是要断言 IP 字面量被认出来
    expect(isIpLiteralHost("192.168.1.10")).toBe(true); // NOSONAR
  });

  it("主机名不是 IP 字面量", () => {
    expect(isIpLiteralHost("localhost")).toBe(false);
    expect(isIpLiteralHost("example.com")).toBe(false);
    expect(isIpLiteralHost("127.0.0.1.nip.io")).toBe(false);
  });

  it("不合法的四段数字不是 IP 字面量", () => {
    expect(isIpLiteralHost("999.999.999.999")).toBe(false);
    expect(isIpLiteralHost("1.2.3")).toBe(false);
  });

  it("方括号包起来的 IPv6 是 IP 字面量", () => {
    expect(isIpLiteralHost("[::1]")).toBe(true);
    expect(isIpLiteralHost("[fe80::1]")).toBe(true);
  });

  it("URL 里的 IP 字面量能被找出来", () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- 用例就是要断言 http 地址里的 IP 被找出来
    expect(findIpLiteralUrl("http://127.0.0.1:7799/")).toBe("http://127.0.0.1:7799/"); // NOSONAR
    // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言 env 值里的 IP 被找出来
    expect(findIpLiteralUrl("API=http://10.0.0.1")).toBe("http://10.0.0.1"); // NOSONAR
  });

  it("路径里带 @ 的 IP 地址仍能被发现", () => {
    // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言路径里的 @ 不影响 IP 识别
    expect(findIpLiteralUrl("http://192.0.2.10/users/@me")).toBe("http://192.0.2.10/users/@me"); // NOSONAR
    // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言查询串里的 @ 不影响 IP 识别
    expect(findIpLiteralUrl("https://192.0.2.10/api?mail=a@b.com")).toBe("https://192.0.2.10/api?mail=a@b.com"); // NOSONAR
  });

  it("带 userinfo 的 IP 地址仍能被发现", () => {
    // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言 userinfo 不影响 IP 识别
    expect(findIpLiteralUrl("http://user@192.0.2.10/x")).toBe("http://user@192.0.2.10/x"); // NOSONAR
  });

  it("纯主机名与不带 scheme 的 IP 都放行", () => {
    expect(findIpLiteralUrl("http://localhost:7799/")).toBeNull();
    expect(findIpLiteralUrl("127.0.0.1:7799")).toBeNull();
    expect(findIpLiteralUrl("127.0.0.1")).toBeNull();
  });
});

describe("发布前的网关兼容检查", () => {
  it("preview 是端口号 —— 放行", () => {
    const result = checkPublishCompatibility(
      manifestOf({
        command: "node server.mjs",
        preview: { type: "port", port: 7799 },
      })
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("preview 是主机名地址 —— 放行", () => {
    const result = checkPublishCompatibility(
      manifestOf({ preview: { type: "url", url: "http://localhost:7799/" } })
    );
    expect(result.ok).toBe(true);
  });

  it("preview 指向 IP —— 拦下并提示改用端口", () => {
    const result = checkPublishCompatibility(
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- 用例就是要断言带 IP 的地址被拦下
      manifestOf({ preview: { type: "url", url: "http://127.0.0.1:7799/" } }) // NOSONAR
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].field).toBe("preview");
    expect(result.message).toContain("port");
    expect(result.message).toContain("127.0.0.1");
  });

  it("env 里指向 IP —— 拦下", () => {
    const result = checkPublishCompatibility(
      // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言 env 里的 IP 被拦下
      manifestOf({ command: "node server.mjs", env: { API: "http://10.0.0.1" } }) // NOSONAR
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0].field).toBe("env");
    expect(result.issues[0].key).toBe("API");
  });

  it("env 里是不带 scheme 的 IP —— 放行", () => {
    const result = checkPublishCompatibility(
      manifestOf({ command: "node server.mjs", env: { API: "127.0.0.1:7799" } })
    );
    expect(result.ok).toBe(true);
  });

  it("网络能力里指向 IP —— 拦下", () => {
    const result = checkPublishCompatibility(
      manifestOf(
        { command: "node server.mjs" },
        // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言网络能力里的 IP 被拦下
        { network: ["https://api.example.com/*", "http://192.168.1.10/*"] } // NOSONAR
      )
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0].field).toBe("network");
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- 用例就是要断言提示里带着那个 IP
    expect(result.message).toContain("192.168.1.10"); // NOSONAR
  });

  it("网络能力里是不带 scheme 的模式 —— 放行", () => {
    const result = checkPublishCompatibility(
      manifestOf(
        { command: "node server.mjs" },
        { network: ["127.0.0.1:*", "localhost:*"] }
      )
    );
    expect(result.ok).toBe(true);
  });

  it("三处都有问题时一次全报出来", () => {
    const result = checkPublishCompatibility(
      manifestOf(
        {
          // eslint-disable-next-line sonarjs/no-clear-text-protocols -- 用例就是要断言带 IP 的地址被拦下
          preview: { type: "url", url: "http://127.0.0.1:7799/" }, // NOSONAR
          // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言 env 里的 IP 被拦下
          env: { API: "http://10.0.0.1" }, // NOSONAR
        },
        // eslint-disable-next-line sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols -- 用例就是要断言网络能力里的 IP 被拦下
        { network: ["http://192.168.1.10/*"] } // NOSONAR
      )
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toEqual([
      "preview",
      "env",
      "network",
    ]);
    expect(result.message.split("\n")).toHaveLength(3);
  });

  it("清单不是合法 JSON —— 不炸，也不拦", () => {
    expect(findIpLiteralIssues("not json")).toEqual([]);
    expect(checkPublishCompatibility("not json").ok).toBe(true);
  });

  it("清单里没有 runtime 段 —— 不炸", () => {
    expect(checkPublishCompatibility('{"id":"local.demo"}').ok).toBe(true);
  });
});
