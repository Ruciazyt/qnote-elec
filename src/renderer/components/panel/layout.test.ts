import { describe, it, expect } from "vitest";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_BUTTON_SIZE,
  PANEL_COLLAPSED_WIDTH,
  PANEL_HEADER_PADDING_X,
  PANEL_RAIL_LABEL_INSET,
  PANEL_RESIZER_WIDTH,
  clampPanelWidth,
} from "./layout";


describe("折叠轨道几何常量", () => {
  it("轨道宽度 = 按钮内缩 × 2 + 按钮边长", () => {
    expect(PANEL_COLLAPSED_WIDTH).toBe(
      PANEL_COLLAPSED_BUTTON_INSET * 2 + PANEL_COLLAPSED_BUTTON_SIZE
    );
  });

  it("折叠态内缩与展开态头部内边距相等（两态零位移的前提）", () => {
    expect(PANEL_COLLAPSED_BUTTON_INSET).toBe(PANEL_HEADER_PADDING_X);
  });

  it("折叠轨宽 = 2 × 展开态头部左内边距 + 按钮边长（零位移的唯一约束式）", () => {
    expect(PANEL_COLLAPSED_WIDTH).toBe(
      PANEL_HEADER_PADDING_X * 2 + PANEL_COLLAPSED_BUTTON_SIZE
    );
  });

  it("左右留白相等，且 focus 描边外扩 1px 后仍有 ≥4px 余量", () => {
    const left = PANEL_COLLAPSED_BUTTON_INSET;
    const right =
      PANEL_COLLAPSED_WIDTH - PANEL_COLLAPSED_BUTTON_INSET - PANEL_COLLAPSED_BUTTON_SIZE;

    expect(right).toBe(left);
    expect(left - 1).toBeGreaterThanOrEqual(4);
  });

  it("当前几何规格：轨道 48、按钮 32、内缩 8", () => {
    expect(PANEL_COLLAPSED_WIDTH).toBe(48);
    expect(PANEL_COLLAPSED_BUTTON_SIZE).toBe(32);
    expect(PANEL_COLLAPSED_BUTTON_INSET).toBe(8);
    expect(PANEL_HEADER_PADDING_X).toBe(8);
  });

  it("竖排标签内缩：左右各留一次，描边外扩 1px 后仍余 ≥2px", () => {
    expect(PANEL_RAIL_LABEL_INSET).toBe(4);

    expect(PANEL_RAIL_LABEL_INSET - 1).toBe(3);
    expect(PANEL_RAIL_LABEL_INSET - 2).toBeGreaterThanOrEqual(2);
    expect(PANEL_RAIL_LABEL_INSET - 3).toBeLessThan(2);
  });

  it("竖排标签左右内缩后仍留得出标签盒（不能把轨道挤空）", () => {
    const labelBoxWidth = PANEL_COLLAPSED_WIDTH - PANEL_RAIL_LABEL_INSET * 2;

    expect(labelBoxWidth).toBe(40);
    expect(labelBoxWidth).toBeGreaterThan(0);
  });

  it("分割线是 flex 子节点，厚度为正", () => {
    expect(PANEL_RESIZER_WIDTH).toBeGreaterThan(0);
  });
});

describe("clampPanelWidth", () => {
  it("把宽度钳制到允许区间内", () => {
    expect(clampPanelWidth(300, 220, 560)).toBe(300);
    expect(clampPanelWidth(100, 220, 560)).toBe(220);
    expect(clampPanelWidth(900, 220, 560)).toBe(560);
  });

  it("小数宽度先四舍五入再钳制", () => {
    expect(clampPanelWidth(288.4, 220, 560)).toBe(288);
    expect(clampPanelWidth(288.6, 220, 560)).toBe(289);
  });

  it("min 大于 max 时以 min 为准（不返回比 min 更小的宽度）", () => {
    expect(clampPanelWidth(300, 220, 200)).toBe(220);
  });

  it("区间边界上的值原样返回", () => {
    expect(clampPanelWidth(220, 220, 560)).toBe(220);
    expect(clampPanelWidth(560, 220, 560)).toBe(560);
  });
});
