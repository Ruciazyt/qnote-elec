import { vi } from "vitest";
import { readAllowedApiNames } from "./electron-contract";

type ElectronStub = Window["electron"];

/**
 * 渲染层在 Electron 里跑，window.electron 由 preload 注入；测试环境没有 preload。
 *
 * 白名单规则：只放行「preload 真的暴露了」且「electron.d.ts 真的声明了」的 API。
 * 其余名字一律抛错。
 *
 * 以前这里是 Proxy 兜底 —— 任何名字都自动返回一个 resolve(undefined) 的假函数。
 * 好处是组件随便调都不炸，坏处是更致命：
 * preload、electron.d.ts、渲染层调用三处只要有一处对不上，用例照样全绿，
 * 断链要到真机上才暴露成 undefined。
 * 白名单把这条兜底拆掉，绿测试才等于 IPC 真的通了。
 *
 * 用法：setup.ts 在每个用例前装一份干净的默认桩；
 * 用例要断言数据时，在自己的 beforeEach 里重新装一次带 overrides 的桩（会覆盖默认桩）。
 */
export function createElectronStub(overrides: Record<string, unknown> = {}): ElectronStub {
  const allowed = readAllowedApiNames();
  const methods = new Map<string, unknown>(Object.entries(overrides));

  const stub = new Proxy(
    {},
    {
      get(_target, prop) {
        // 符号属性（Symbol.toPrimitive 等）不生成桩，避免影响隐式转换
        if (typeof prop !== "string") return undefined;
        // then：桩不能是 thenable —— await / Promise.resolve 探这个属性时不能抛
        if (prop === "then") return undefined;

        if (!methods.has(prop)) {
          if (!allowed.has(prop)) {
            throw new Error(
              `window.electron.${prop} 不存在：preload 未暴露，或 electron.d.ts 未声明。` +
                `新增 IPC 要同步 src/main/handlers/<模块>.ts、src/main/preload.ts、` +
                `src/renderer/electron.d.ts 三处。`
            );
          }
          methods.set(prop, vi.fn(() => Promise.resolve(undefined)));
        }
        return methods.get(prop);
      },
      has(_target, prop) {
        return typeof prop === "string" && allowed.has(prop);
      },
    }
  );

  return stub as unknown as ElectronStub;
}
