import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDevRoot } from "../../utils/paths";

const nativeBuilt = fs.existsSync(path.join(getDevRoot(), "dist", "native", "notes-rs.cjs"));

async function loadLoader(mode: string) {
  vi.stubEnv("RUST_ANYTHING_MODE", mode);
  vi.resetModules();
  return import("./nativeModules");
}

type Loader = Awaited<ReturnType<typeof loadLoader>>;

describe("原生模块加载器的运行模式", () => {
  let oldLoader: Loader;
  let autoLoader: Loader;
  let newLoader: Loader;
  let shadowLoader: Loader;

  beforeAll(async () => {
    oldLoader = await loadLoader("old");
    autoLoader = await loadLoader("auto");
    newLoader = await loadLoader("new");
    shadowLoader = await loadLoader("shadow");
  }, 180000);

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("old 模式不加载原生模块，直接走 TypeScript", () => {
    expect(oldLoader.nativeMode()).toBe("old");
    expect(oldLoader.loadNative("notes-rs.cjs")).toBeNull();
    expect(oldLoader.nativePath("notes-rs.cjs")).toBeNull();
  });

  it("auto 模式在原生模块缺失时返回 null", () => {
    expect(autoLoader.nativeMode()).toBe("auto");
    expect(autoLoader.loadNative("definitely-missing-wrapper.cjs")).toBeNull();
  });

  it("new 模式缺原生模块时直接报错", () => {
    expect(() => newLoader.loadNative("definitely-missing-wrapper.cjs")).toThrow(
      /RUST_ANYTHING_MODE=new/
    );
  });

  it("auto 模式加载到原生模块后记住路径", () => {
    const loaded = autoLoader.loadNative("notes-rs.cjs");
    expect(loaded !== null).toBe(nativeBuilt);
    if (nativeBuilt) {
      expect(autoLoader.nativePath("notes-rs.cjs")).toContain("notes-rs.cjs");
    }
  });

  it("同一个封装只尝试加载一次", () => {
    autoLoader.loadNative("notes-rs.cjs");
    const again = autoLoader.loadNative("notes-rs.cjs");
    expect(again !== null).toBe(nativeBuilt);
  });

  it("nativeCall 在没有原生模块时返回兜底结果", () => {
    const value = oldLoader.nativeCall<number, unknown>(
      "notes-rs.cjs",
      "contentHash",
      () => 42,
      () => 7
    );
    expect(value).toBe(42);
  });

  it("shadow 模式以 TypeScript 结果为准", () => {
    const value = shadowLoader.nativeCall<string, { contentHash(input: string): string }>(
      "notes-rs.cjs",
      "contentHash",
      () => "ts-result",
      (module) => module.contentHash("x")
    );
    expect(value).toBe("ts-result");
  });

  it("shadow 模式在原生实现存在时两边都跑一遍", () => {
    let invoked = 0;
    const value = shadowLoader.nativeCall<string, { contentHash(input: string): string }>(
      "notes-rs.cjs",
      "contentHash",
      () => "ts-result",
      (module) => {
        invoked += 1;
        return module.contentHash("x");
      }
    );
    expect(value).toBe("ts-result");
    expect(invoked).toBe(nativeBuilt ? 1 : 0);
  });

  it("原生模块加载失败时回退到 TypeScript", async () => {
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        default: actual,
        existsSync: (target: string) => String(target).endsWith("broken-rs.cjs"),
      };
    });
    const loader = await loadLoader("auto");
    expect(loader.loadNative("broken-rs.cjs")).toBeNull();
  }, 60000);
});
