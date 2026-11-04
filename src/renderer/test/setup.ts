import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { createElectronStub } from "./electron-stub";

// jsdom 没有 ResizeObserver —— 渲染层有几处靠它跟随容器尺寸变化
// （ResizableSidebar 用它量父级宽度），没有它组件会在挂载时直接抛错。
// 这里给一个空实现：回调永不触发，但组件不会崩。
// （要验真实尺寸变化，另走「真实 CSS + 无头 Electron 量 DOM」那条路。）
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// 渲染层跑在 Electron 里，window.electron 由 preload 注入；测试环境没有 preload。
// 每个用例前装一份干净的桩，避免上一个用例的调用记录串味。
beforeEach(() => {
  window.electron = createElectronStub();
});

afterEach(() => {
  cleanup();
  // localStorage 跨用例共享，不清会让「默认折叠」这类用例被上一个用例的状态污染
  window.localStorage.clear();
});
