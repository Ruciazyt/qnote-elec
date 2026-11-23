// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { packProjectBundle, unpackProjectBundle } from "./bundle";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-bundle-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
}

describe("资源包打包", () => {
  it("打包再解开，文件内容不变", () => {
    write("server.mjs", "console.log('hi')");
    write("public/index.html", "<h1>hi</h1>");

    const packed = packProjectBundle(dir);
    expect(packed.tooLarge).toBe(false);
    expect(packed.fileCount).toBe(2);

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-unpack-"));
    unpackProjectBundle(target, packed.bundle);

    expect(fs.readFileSync(path.join(target, "server.mjs"), "utf-8")).toBe(
      "console.log('hi')"
    );
    expect(fs.readFileSync(path.join(target, "public", "index.html"), "utf-8")).toBe(
      "<h1>hi</h1>"
    );
    fs.rmSync(target, { recursive: true, force: true });
  });

  it("依赖目录、缓存与密钥文件不上传", () => {
    write("server.mjs", "ok");
    write("node_modules/left-pad/index.js", "big");
    write(".git/config", "secret");
    write("scripts/.cache/data.json", "cache");
    write(".env", "TOKEN=abc");
    write("key.pem", "-----BEGIN");
    write("plugin.json", "{}");

    const packed = packProjectBundle(dir);

    expect(packed.fileCount).toBe(1);
    expect(packed.skipped).toEqual(
      expect.arrayContaining([
        "node_modules",
        ".git",
        "scripts/.cache",
        ".env",
        "key.pem",
        "plugin.json",
      ])
    );
  });

  it("超过体积上限就不打包", () => {
    write("big.bin", "x".repeat(4096));

    const packed = packProjectBundle(dir, 1024);

    expect(packed.tooLarge).toBe(true);
    expect(packed.bundle).toBe("");
    expect(packed.fileCount).toBe(0);
  });

  it("包里出现越界的路径就拒绝解开", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-unpack-"));
    const evil = Buffer.from(
      JSON.stringify({ "../escaped.txt": Buffer.from("bad").toString("base64") })
    );
    const { deflateRawSync } = require("node:zlib") as typeof import("node:zlib");

    expect(() =>
      unpackProjectBundle(target, deflateRawSync(evil).toString("base64"))
    ).toThrow(/越界/);
    expect(fs.existsSync(path.join(path.dirname(target), "escaped.txt"))).toBe(false);
    fs.rmSync(target, { recursive: true, force: true });
  });
});
