// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const mocks = vi.hoisted(() => ({
  isPackaged: false,
  version: "9.9.9",
  throwOnGet: false,
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
    getVersion: () => {
      if (mocks.throwOnGet) throw new Error("取不到版本");
      return mocks.version;
    },
  },
}));

import { appVersion } from "./appVersion";
import { getDevRoot } from "../../utils/paths";

function rootVersion(): string {
  const raw = fs.readFileSync(path.join(getDevRoot(), "package.json"), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

describe("appVersion", () => {
  it("开发态读仓库根 package.json，不回退成 Electron 版本", () => {
    mocks.isPackaged = false;
    mocks.version = "45.1.0";
    mocks.throwOnGet = false;

    expect(appVersion()).toBe(rootVersion());
    expect(appVersion()).not.toBe("45.1.0");
  });

  it("打包态用 app.getVersion()", () => {
    mocks.isPackaged = true;
    mocks.version = "2.0.0";
    mocks.throwOnGet = false;

    expect(appVersion()).toBe("2.0.0");
  });

  it("打包态取不到版本时返回 0.0.0 而不是抛错", () => {
    mocks.isPackaged = true;
    mocks.throwOnGet = true;

    expect(appVersion()).toBe("0.0.0");
  });
});
