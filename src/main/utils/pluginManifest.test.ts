// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PLUGIN_MANIFEST_FILENAME,
  readPluginManifestFromDir,
  writePluginManifestToDir,
} from "./pluginManifest";
import type { PluginManifest } from "../../shared/plugin/pluginTypes";

const VALID: PluginManifest = {
  id: "demo.my-plugin",
  name: "演示插件",
  version: "1.0.0",
  publisher: "demo",
  engines: { qnote: "^2.0.0" },
  runtime: { command: "node server.js" },
};

describe("插件清单读写", () => {
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-plugin-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("读清单", () => {
    it("目录里没有清单时标 missing", () => {
      const result = readPluginManifestFromDir(dir);
      expect(result.manifest).toBeNull();
      expect(result.missing).toBe(true);
      expect(result.error).toContain(PLUGIN_MANIFEST_FILENAME);
    });

    it("清单不合法时报错并保留原文", () => {
      fs.writeFileSync(path.join(dir, PLUGIN_MANIFEST_FILENAME), "{ 坏掉的", "utf-8");
      const result = readPluginManifestFromDir(dir);
      expect(result.manifest).toBeNull();
      expect(result.missing).toBeUndefined();
      expect(result.raw).toBe("{ 坏掉的");
    });

    it("合法的清单能读出来", () => {
      fs.writeFileSync(
        path.join(dir, PLUGIN_MANIFEST_FILENAME),
        JSON.stringify(VALID, null, 2),
        "utf-8"
      );
      const result = readPluginManifestFromDir(dir);
      expect(result.error).toBeUndefined();
      expect(result.manifest?.id).toBe("demo.my-plugin");
    });
  });

  describe("写清单", () => {
    it("写入后能读回来", () => {
      const written = writePluginManifestToDir(dir, VALID);
      expect(written.ok).toBe(true);

      const result = readPluginManifestFromDir(dir);
      expect(result.manifest?.id).toBe("demo.my-plugin");
      expect(result.manifest?.runtime.command).toBe("node server.js");
    });

    it("目录不存在时报错", () => {
      const written = writePluginManifestToDir(path.join(dir, "不存在"), VALID);
      expect(written.ok).toBe(false);
      expect(written.error).toContain("不存在");
    });

    it("清单不合法时不落盘", () => {
      const broken = { ...VALID, id: "没有点" };
      const written = writePluginManifestToDir(dir, broken);
      expect(written.ok).toBe(false);
      expect(fs.existsSync(path.join(dir, PLUGIN_MANIFEST_FILENAME))).toBe(false);
    });
  });
});
