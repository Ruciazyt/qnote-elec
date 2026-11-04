import { describe, it, expect } from "vitest";
import { SHORTCUT_PANEL_COLLAPSED_WIDTH, SHORTCUT_PANEL_WIDTH } from "./types";
import { PANEL_COLLAPSED_WIDTH } from "@/components/panel/layout";

describe("快捷方式面板宽度常量", () => {
  it("折叠轨宽度取共享的折叠轨道宽度，不再自己写 44", () => {
    expect(SHORTCUT_PANEL_COLLAPSED_WIDTH).toBe(PANEL_COLLAPSED_WIDTH);
    expect(SHORTCUT_PANEL_COLLAPSED_WIDTH).toBe(48);
  });

  it("展开态宽度明显宽于折叠态", () => {
    expect(SHORTCUT_PANEL_WIDTH).toBeGreaterThan(SHORTCUT_PANEL_COLLAPSED_WIDTH);
  });
});
