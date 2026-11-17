// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getPreloadPath, getDevRoot } from "./paths";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN_DIR = path.resolve(HERE, "..", "..");

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("运行时路径解析", () => {
  it("preload 路径落在 dist/main 下", () => {
    expect(getPreloadPath().endsWith(path.join("dist", "main", "preload.js"))).toBe(true);
  });

  it("开发态仓库根下找得到 package.json", () => {
    expect(fs.existsSync(path.join(getDevRoot(), "package.json"))).toBe(true);
  });

  it("主进程里没有手拼 __dirname 的 preload 路径", () => {
    const offenders = listSources(MAIN_DIR)
      .filter((file) => !file.endsWith("paths.ts") && !file.endsWith("paths.test.ts"))
      .filter((file) => {
        const text = fs.readFileSync(file, "utf8");
        return text.includes("preload.js") && text.includes("__dirname");
      })
      .map((file) => path.relative(MAIN_DIR, file));

    expect(offenders).toEqual([]);
  });
});
