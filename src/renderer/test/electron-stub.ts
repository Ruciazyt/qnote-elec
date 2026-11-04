import { vi } from "vitest";

type ElectronStub = Window["electron"];

/**
 * 渲染层在 Electron 里跑，window.electron 由 preload 注入；测试环境没有 preload，
 * 组件里 `window.electron.xxx()` 会直接抛「不是函数」。
 *
 * 这里给一个兜底桩：
 * - 没显式指定的方法名一律返回空 Promise，组件 await 得到 undefined，不会炸；
 * - 传了 overrides 的方法按 overrides 走，用例可以自己断言调用参数。
 *
 * 用法：setup.ts 在每个用例前装一份干净的默认桩；
 * 用例要断言数据时，在自己的 beforeEach 里重新装一次带 overrides 的桩（会覆盖默认桩）。
 */
export function createElectronStub(overrides: Record<string, unknown> = {}): ElectronStub {
  const methods = new Map<string, unknown>(Object.entries(overrides));

  const stub = new Proxy(
    {},
    {
      get(_target, prop) {
        // 符号属性（Symbol.toPrimitive 等）不生成桩，避免影响隐式转换
        if (typeof prop !== "string") return undefined;
        if (!methods.has(prop)) {
          methods.set(prop, vi.fn(() => Promise.resolve(undefined)));
        }
        return methods.get(prop);
      },
      has(_target, prop) {
        return typeof prop === "string" && methods.has(prop);
      },
    }
  );

  return stub as unknown as ElectronStub;
}
