import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePluginManifest } from "@shared/plugin/manifest/pluginManifest";

const here = path.dirname(fileURLToPath(import.meta.url));

function readManifest(): string {
  return fs.readFileSync(path.join(here, "plugin.json"), "utf8");
}

describe("示例插件", () => {
  it("清单能通过校验", () => {
    const parsed = parsePluginManifest(readManifest());
    expect(parsed.error).toBeUndefined();
    expect(parsed.manifest?.id).toBe("local.hello-qnote");
    expect(parsed.manifest?.engines.qnote).toBeTruthy();
  });

  it("声明了起子进程的权限，否则起不来", () => {
    const parsed = parsePluginManifest(readManifest());
    expect(parsed.manifest?.capabilities?.process?.spawn).toBe(true);
  });

  it("入口文件与预览页面都在", () => {
    const parsed = parsePluginManifest(readManifest());
    expect(parsed.manifest?.runtime.command).toBe("node main.js");
    expect(fs.existsSync(path.join(here, "main.js"))).toBe(true);
    expect(
      fs.existsSync(path.join(here, "preview", "index.html"))
    ).toBe(true);
  });
});
