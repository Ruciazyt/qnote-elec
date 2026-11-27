// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  agentFilePath,
  buildOpencodeWorkspace,
  buildWorkspaceConfig,
  configFilePath,
  excludeFromGit,
  writeOpencodeWorkspace,
  writeWorkspaceToDirectory,
} from "../workspace";

describe("opencode 工作区", () => {
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-opencode-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("配置里带上 MCP 地址与令牌", () => {
    const config = buildWorkspaceConfig({
      directory: dir,
      mcpUrl: "http://127.0.0.1:1234/mcp",
      mcpToken: "tkn",
    });
    const server = config.mcp.qnote as Record<string, any>;
    expect(server.type).toBe("remote");
    expect(server.url).toBe("http://127.0.0.1:1234/mcp");
    expect(server.enabled).toBe(true);
    expect(server.headers.Authorization).toBe("Bearer tkn");
    expect(config.experimental.continue_loop_on_deny).toBe(true);
  });

  it("provider 映射成 opencode 的自定义 provider", () => {
    const config = buildWorkspaceConfig({
      directory: dir,
      mcpUrl: "u",
      mcpToken: "t",
      provider: {
        id: "qnote",
        npm: "@ai-sdk/openai-compatible",
        name: "QNote",
        apiKey: "k",
        baseURL: "https://example.com/v1",
        model: "gpt-4o",
      },
    });
    const entry = (config.provider as Record<string, any>).qnote;
    expect(entry.npm).toBe("@ai-sdk/openai-compatible");
    expect(entry.options).toEqual({ apiKey: "k", baseURL: "https://example.com/v1" });
    expect(entry.models["gpt-4o"].name).toBe("gpt-4o");
  });

  it("写文件且内容没变就不重写", () => {
    const files = buildOpencodeWorkspace({
      directory: dir,
      mcpUrl: "u",
      mcpToken: "t",
    });
    const first = writeOpencodeWorkspace(dir, files.configJson, {
      qnote: files.agentMarkdown,
      "qnote-code": files.codeAgentMarkdown,
    });
    expect(first.configChanged).toBe(true);
    expect(first.agentChanged).toBe(true);
    expect(fs.existsSync(configFilePath(dir))).toBe(true);
    expect(fs.existsSync(agentFilePath(dir))).toBe(true);
    expect(fs.existsSync(agentFilePath(dir, "qnote-code"))).toBe(true);

    const second = writeOpencodeWorkspace(dir, files.configJson, {
      qnote: files.agentMarkdown,
      "qnote-code": files.codeAgentMarkdown,
    });
    expect(second.configChanged).toBe(false);
    expect(second.agentChanged).toBe(false);
  });

  it("把配置同步到会话目录", () => {
    const files = buildOpencodeWorkspace({
      directory: dir,
      mcpUrl: "u",
      mcpToken: "t",
    });
    const target = path.join(dir, "repo");
    fs.mkdirSync(target, { recursive: true });
    expect(writeWorkspaceToDirectory(target, files)).toBe(true);
    expect(fs.existsSync(path.join(target, "opencode.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(target, ".opencode", "agents", "qnote-code.md"))
    ).toBe(true);
  });

  it("目录不存在时不同步", () => {
    const files = buildOpencodeWorkspace({
      directory: dir,
      mcpUrl: "u",
      mcpToken: "t",
    });
    expect(writeWorkspaceToDirectory(path.join(dir, "missing"), files)).toBe(
      false
    );
  });

  it("把 opencode 配置加进 git 本地排除", () => {
    const target = path.join(dir, "repo");
    fs.mkdirSync(path.join(target, ".git", "info"), { recursive: true });
    excludeFromGit(target, ["/opencode.json", "/.opencode/"]);
    const exclude = fs.readFileSync(
      path.join(target, ".git", "info", "exclude"),
      "utf8"
    );
    expect(exclude).toContain("/opencode.json");
    expect(exclude).toContain("/.opencode/");
  });

  it("重复排除不会重复追加", () => {
    const target = path.join(dir, "repo");
    fs.mkdirSync(path.join(target, ".git", "info"), { recursive: true });
    excludeFromGit(target, ["/opencode.json"]);
    excludeFromGit(target, ["/opencode.json"]);
    const exclude = fs.readFileSync(
      path.join(target, ".git", "info", "exclude"),
      "utf8"
    );
    expect(exclude.split("/opencode.json").length - 1).toBe(1);
  });

  it("不是 git 仓库时跳过排除", () => {
    const target = path.join(dir, "plain");
    fs.mkdirSync(target, { recursive: true });
    expect(() => excludeFromGit(target, ["/opencode.json"])).not.toThrow();
    expect(fs.existsSync(path.join(target, ".git"))).toBe(false);
  });
});
