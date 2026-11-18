import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { createElectronStub } from "./electron-stub";


if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {
    }
    unobserve() {
    }
    disconnect() {
    }
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof window !== "undefined" && typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
  };
}

if (typeof window !== "undefined") {
  beforeEach(() => {
    window.electron = createElectronStub();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });
}
