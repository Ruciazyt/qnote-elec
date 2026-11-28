import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "./log";
import { getDevRoot } from "../../utils/paths";

export type NativeMode = "auto" | "old" | "shadow" | "new";

const MODE: NativeMode = (process.env.RUST_ANYTHING_MODE as NativeMode) || "auto";

const loaded = new Map<string, unknown>();
const paths = new Map<string, string>();
const tried = new Set<string>();

export function nativeMode(): NativeMode {
  return MODE;
}

export function nativeDirs(): string[] {
  const dirs = [path.join(getDevRoot(), "dist", "native")];
  dirs.push(path.resolve(__dirname, "..", "..", "..", "native"));
  if (process.resourcesPath) {
    dirs.push(path.join(process.resourcesPath, "native"));
  }
  return dirs;
}

export function nativePath(wrapper: string): string | null {
  return paths.get(wrapper) ?? null;
}

export function loadNative<T>(wrapper: string): T | null {
  if (loaded.has(wrapper)) return loaded.get(wrapper) as T;
  if (tried.has(wrapper)) {
    if (MODE === "new") {
      throw new Error(`RUST_ANYTHING_MODE=new，但没找到 Rust 原生模块 ${wrapper}`);
    }
    return null;
  }
  tried.add(wrapper);
  if (MODE === "old") return null;

  for (const dir of nativeDirs()) {
    const entry = path.join(dir, wrapper);
    if (!fs.existsSync(entry)) continue;
    try {
      const module = require(entry) as T;
      loaded.set(wrapper, module);
      paths.set(wrapper, entry);
      log.info("已加载 Rust 原生模块", { path: entry, mode: MODE });
      return module;
    } catch (error) {
      log.warn("Rust 原生模块加载失败，回退到 TypeScript 实现", { path: entry, error });
      return null;
    }
  }

  if (MODE === "new") {
    throw new Error(`RUST_ANYTHING_MODE=new，但没找到 Rust 原生模块 ${wrapper}`);
  }
  log.info("没有 Rust 原生模块，使用 TypeScript 实现", { wrapper });
  return null;
}

export function nativeCall<T, M>(
  wrapper: string,
  name: string,
  fallback: () => T,
  invoke: (module: M) => T
): T {
  const module = loadNative<M>(wrapper);
  if (!module) return fallback();

  if (MODE === "shadow") {
    const expected = fallback();
    const actual = invoke(module);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      log.warn("[rust-anything] 结果不一致", { fn: name, expected, actual });
    }
    return expected;
  }

  return invoke(module);
}
