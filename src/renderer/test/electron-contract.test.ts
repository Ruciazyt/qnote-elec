import { describe, it, expect } from "vitest";
import {
  compareContract,
  parseDeclaredApiNames,
  parseExposedApiNames,
  readAllowedApiNames,
  readContract,
} from "./electron-contract";


const KNOWN_STALE_DECLARATIONS: string[] = [];

const contract = readContract();

describe("preload 与 electron.d.ts 的双向覆盖", () => {
  it("preload 暴露的 API 全部在 electron.d.ts 里有声明", () => {
    expect(contract.exposedButNotDeclared).toEqual([]);
  });

  it("electron.d.ts 里没有「类型还在、preload 已删」的陈旧声明", () => {
    const unexpected = contract.declaredButNotExposed.filter(
      (name) => !KNOWN_STALE_DECLARATIONS.includes(name)
    );
    expect(unexpected).toEqual([]);
  });

  it("豁免名单与实际漂移一致（漂移清掉后这条会红，提醒同步删名单）", () => {
    const stillThere = contract.declaredButNotExposed
      .filter((name) => KNOWN_STALE_DECLARATIONS.includes(name))
      .sort();
    expect(stillThere).toEqual([...KNOWN_STALE_DECLARATIONS].sort());
  });

  it("白名单里的 API 数 = 两边的交集（少一边都不算数）", () => {
    expect(contract.allowed.size).toBe(
      contract.declared.length - contract.declaredButNotExposed.length
    );
  });

  it("桩用的白名单与这里算出的交集是同一份", () => {
    expect([...readAllowedApiNames()].sort()).toEqual([...contract.allowed].sort());
  });
});

describe("渲染层调用点", () => {
  it("渲染层调用的 API 都在契约内（preload 暴露 + electron.d.ts 声明）", () => {
    expect(contract.usagesOutsideContract).toEqual([]);
  });

  it("扫描没退化成空集（调用点确实被扫到了）", () => {
    expect(contract.usages.size).toBeGreaterThan(50);
  });
});

describe("桩的白名单", () => {
  it("未声明的 API 直接抛错，不做兜底", () => {
    expect(() => (window.electron as Record<string, unknown>).notAnApi()).toThrow(
      /notAnApi/
    );
  });

  it("已声明的 API 返回可 await 的桩", async () => {
    await expect(window.electron.getAppInfo()).resolves.toBeUndefined();
  });

  it("陈旧声明不在白名单里 —— 类型还在、preload 已删的调用会当场炸", () => {
    for (const name of contract.declaredButNotExposed) {
      expect(() => (window.electron as Record<string, unknown>)[name]()).toThrow();
    }
  });

  it("被删掉的历史 API 不再是桩的一部分", () => {
    for (const name of ["send", "onSaveNotification", "getAiToolsConfig", "setAiToolsConfig"]) {
      expect(() => (window.electron as Record<string, unknown>)[name]).toThrow();
    }
  });
});

describe("守卫本身能抓漂移（变异输入）", () => {

  it("声明多一个 → 判为陈旧声明（类型还在、preload 已删）", () => {
    const diff = compareContract({
      declared: ["a", "b", "ghost"],
      exposed: ["a", "b"],
      usages: new Map(),
    });
    expect(diff.declaredButNotExposed).toEqual(["ghost"]);
  });

  it("暴露多一个 → 判为暴露未声明", () => {
    const diff = compareContract({
      declared: ["a", "b"],
      exposed: ["a", "b", "ghost"],
      usages: new Map(),
    });
    expect(diff.exposedButNotDeclared).toEqual(["ghost"]);
  });

  it("渲染层调了契约外的 API → 判为断链", () => {
    const diff = compareContract({
      declared: ["a"],
      exposed: ["a"],
      usages: new Map([["ghost", ["pages/X.tsx"]]]),
    });
    expect(diff.usagesOutsideContract).toEqual(["ghost"]);
  });

  it("白名单只收两边的交集", () => {
    const diff = compareContract({
      declared: ["a", "ghost"],
      exposed: ["a", "other"],
      usages: new Map(),
    });
    expect([...diff.allowed]).toEqual(["a"]);
  });
});

describe("解析器", () => {
  it("preload 一行放两个键也能都解析出来", () => {
    const source = `contextBridge.exposeInMainWorld("electron", { a: () => 1, b: () => 2 });`;
    expect(parseExposedApiNames(source)).toEqual(["a", "b"]);
  });

  it("跨行的成员签名不影响解析", () => {
    const source = `contextBridge.exposeInMainWorld("electron", {
      saveTemplate: (template: { id: string }) =>
        ipcRenderer.invoke("save-template", template),
      deleteTemplate: (id: string) => ipcRenderer.invoke("delete-template", id),
    });`;
    expect(parseExposedApiNames(source)).toEqual(["saveTemplate", "deleteTemplate"]);
  });

  it("暴露给别的全局名时不计入渲染层 API", () => {
    const source = `contextBridge.exposeInMainWorld("other", { a: () => 1 });`;
    expect(parseExposedApiNames(source)).toEqual([]);
  });

  it("声明表只认 ElectronAPI 接口", () => {
    const source = `interface ElectronAPI { foo: () => void; bar: () => void; }
interface Other { baz: () => void; }`;
    expect(parseDeclaredApiNames(source)).toEqual(["foo", "bar"]);
  });
});
