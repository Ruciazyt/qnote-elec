import { vi } from "vitest";
import { readAllowedApiNames } from "./electron-contract";

type ElectronStub = Window["electron"];

export function createElectronStub(overrides: Record<string, unknown> = {}): ElectronStub {
  const allowed = readAllowedApiNames();
  const methods = new Map<string, unknown>(Object.entries(overrides));

  const stub = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
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
