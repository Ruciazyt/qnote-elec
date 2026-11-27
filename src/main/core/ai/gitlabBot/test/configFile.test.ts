// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseRunnerConfigToml,
  runnerConfigIsUsable,
} from "../runner/configFile";

const SAMPLE = [
  "concurrent = 1",
  "check_interval = 0",
  "shutdown_timeout = 0",
  "",
  "[session_server]",
  "  session_timeout = 1800",
  "",
  "[[runners]]",
  '  name = "qnote-local"',
  '  url = "https://gitlab.example.com"',
  "  id = 5320",
  '  token = "glrt-abc"',
  "  token_obtained_at = 2026-11-27T01:35:07Z",
  "  token_expires_at = 0001-01-01T00:00:00Z",
  '  executor = "shell"',
  '  shell = "powershell"',
  "",
].join("\n");

describe("runner config.toml 解析", () => {
  it("读出 url、token、id 与执行器", () => {
    const info = parseRunnerConfigToml(SAMPLE);
    expect(info).not.toBeNull();
    expect(info?.url).toBe("https://gitlab.example.com");
    expect(info?.token).toBe("glrt-abc");
    expect(info?.id).toBe(5320);
    expect(info?.name).toBe("qnote-local");
    expect(info?.executor).toBe("shell");
    expect(info?.shell).toBe("powershell");
  });

  it("不会把 token_obtained_at 当成 token", () => {
    const info = parseRunnerConfigToml(SAMPLE);
    expect(info?.token).not.toContain("2026-11-27");
  });

  it("空内容返回 null", () => {
    expect(parseRunnerConfigToml("   ")).toBeNull();
  });

  it("没有 token 时返回 null", () => {
    const text = SAMPLE.replace('  token = "glrt-abc"', "");
    expect(parseRunnerConfigToml(text)).toBeNull();
  });

  it("token 与 url 都在时算可用", () => {
    expect(runnerConfigIsUsable(SAMPLE)).toBe(true);
  });

  it("缺 url 时算不可用", () => {
    const text = SAMPLE.replace('  url = "https://gitlab.example.com"', "");
    expect(runnerConfigIsUsable(text)).toBe(false);
  });

  it("缺 token 时算不可用", () => {
    const text = SAMPLE.replace('  token = "glrt-abc"', "");
    expect(runnerConfigIsUsable(text)).toBe(false);
  });
});
