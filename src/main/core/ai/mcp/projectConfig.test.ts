import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadProjectMcpConfig, projectServerId } from "./projectConfig";

const lookup = (values: Record<string, string>) => (name: string) => values[name];

let dir = "";

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-mcp-"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeConfig(content: unknown): void {
  fs.writeFileSync(
    path.join(dir, ".mcp.json"),
    typeof content === "string" ? content : JSON.stringify(content),
    "utf8"
  );
}

describe("loadProjectMcpConfig", () => {
  it("目录为空时没有条目", () => {
    const result = loadProjectMcpConfig(null, lookup({}));
    expect(result.entries).toHaveLength(0);
    expect(result.filePath).toBeNull();
  });

  it("目录里没有配置文件时没有条目", () => {
    const result = loadProjectMcpConfig(path.join(dir, "missing"), lookup({}));
    expect(result.entries).toHaveLength(0);
  });

  it("读取 stdio 与 http 两种配置", () => {
    writeConfig({
      mcpServers: {
        local: { command: "node", args: ["server.js"] },
        remote: { type: "http", url: "https://example.com/mcp" },
      },
    });
    const result = loadProjectMcpConfig(dir, lookup({}));
    expect(result.errors).toHaveLength(0);
    expect(result.entries).toHaveLength(2);
    const local = result.entries.find((entry) => entry.name === "local");
    expect(local?.config.transport).toBe("stdio");
    expect(local?.config.id).toBe(projectServerId("local"));
    const remote = result.entries.find((entry) => entry.name === "remote");
    expect(remote?.config.transport).toBe("http");
  });

  it("streamable-http 归一到 http", () => {
    writeConfig({
      mcpServers: { remote: { type: "streamable-http", url: "https://example.com/mcp" } },
    });
    const result = loadProjectMcpConfig(dir, lookup({}));
    expect(result.entries[0].config.transport).toBe("http");
  });

  it("变量缺失时停用该服务器并给出变量名", () => {
    writeConfig({
      mcpServers: {
        local: { command: "node", env: { TOKEN: "${MISSING}" } },
      },
    });
    const result = loadProjectMcpConfig(dir, lookup({}));
    const entry = result.entries[0];
    expect(entry.config.enabled).toBe(false);
    expect(entry.error).toContain("MISSING");
  });

  it("变量能取到时展开进配置", () => {
    writeConfig({
      mcpServers: {
        local: { command: "node", args: ["--root", "${ROOT}"], env: { TOKEN: "${TOKEN}" } },
      },
    });
    const result = loadProjectMcpConfig(dir, lookup({ ROOT: "D:/work", TOKEN: "t" }));
    const entry = result.entries[0];
    expect(entry.error).toBeUndefined();
    expect(entry.config.args).toEqual(["--root", "D:/work"]);
    expect(entry.config.env?.TOKEN).toBe("t");
  });

  it("disabled 为 false 时停用", () => {
    writeConfig({
      mcpServers: { local: { command: "node", enabled: false } },
    });
    const result = loadProjectMcpConfig(dir, lookup({}));
    expect(result.entries[0].config.enabled).toBe(false);
  });

  it("JSON 坏掉时整份文件失效", () => {
    writeConfig("{ not json");
    const result = loadProjectMcpConfig(dir, lookup({}));
    expect(result.entries).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("缺少 mcpServers 字段时报错", () => {
    writeConfig({ other: {} });
    const result = loadProjectMcpConfig(dir, lookup({}));
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("单个服务器缺命令不影响其他服务器", () => {
    writeConfig({
      mcpServers: {
        broken: { type: "stdio" },
        good: { command: "node" },
      },
    });
    const result = loadProjectMcpConfig(dir, lookup({}));
    expect(result.entries).toHaveLength(2);
    const broken = result.entries.find((entry) => entry.name === "broken");
    expect(broken?.config.enabled).toBe(false);
    expect(broken?.error).toContain("命令");
  });

  it("内容变化时指纹跟着变", () => {
    writeConfig({ mcpServers: { local: { command: "node" } } });
    const first = loadProjectMcpConfig(dir, lookup({}));
    writeConfig({ mcpServers: { local: { command: "node2" } } });
    const second = loadProjectMcpConfig(dir, lookup({}));
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});
