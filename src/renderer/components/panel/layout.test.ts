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

/**
 * 折叠轨道共享常量的不变量
 *
 * 这几个数是四个页面（笔记 / 题单 / 快捷方式 / 应用管理）共用的折叠几何。
 * 它们之间有等式关系 —— 改一边不改另一边，几何立刻就歪：
 *   - 轨道宽度 = 按钮内缩 × 2 + 按钮边长 → 按钮居中，左右留白相等
 *   - 折叠内缩 = 展开态头部内边距 → 两态之间按钮横向零位移
 */

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
    // 折叠态按钮锚在轨道左起 8px，展开态头部左内边距也是 8px，
    // 按钮边长 32 —— 轨宽取 48 = 2×8 + 32，两态按钮都落在 8..40，
    // 横向零位移，且展开态按钮与内容列左缘齐平、不探出内容列。
    // 轨宽一旦偏离这个式子，要么按钮探出轨道，要么两态之间产生位移。
    expect(PANEL_COLLAPSED_WIDTH).toBe(
      PANEL_HEADER_PADDING_X * 2 + PANEL_COLLAPSED_BUTTON_SIZE
    );
  });

  it("左右留白相等，且 focus 描边外扩 1px 后仍有 ≥4px 余量", () => {
    const left = PANEL_COLLAPSED_BUTTON_INSET;
    const right =
      PANEL_COLLAPSED_WIDTH - PANEL_COLLAPSED_BUTTON_INSET - PANEL_COLLAPSED_BUTTON_SIZE;

    expect(right).toBe(left);
    // 描边向外扩 1px，剩下的余量还得够放下描边，否则会被轨道裁掉
    expect(left - 1).toBeGreaterThanOrEqual(4);
  });

  it("当前几何规格：轨道 48、按钮 32、内缩 8", () => {
    expect(PANEL_COLLAPSED_WIDTH).toBe(48);
    expect(PANEL_COLLAPSED_BUTTON_SIZE).toBe(32);
    expect(PANEL_COLLAPSED_BUTTON_INSET).toBe(8);
    expect(PANEL_HEADER_PADDING_X).toBe(8);
  });

  it("竖排标签内缩：左右各留一次，描边外扩 1px 后仍余 ≥2px", () => {
    // 竖排标签是折叠轨上的第二个可聚焦控件，贴着窗口右缘。
    // 不留内缩的话，focus 描边向外扩的那 1px 会超出视口，焦点框缺一条右边；
    // 不留底边距的话，描边往下的 1px 落到轨外，焦点框缺一条底边。
    expect(PANEL_RAIL_LABEL_INSET).toBe(4);

    // 1px 描边：外扩后离边缘还剩 3px
    expect(PANEL_RAIL_LABEL_INSET - 1).toBe(3);
    // 描边加粗到 2px 后余量降到 2px，仍完整可见
    expect(PANEL_RAIL_LABEL_INSET - 2).toBeGreaterThanOrEqual(2);
    // 再加粗到 3px 就只剩 1px，描边几乎贴住视口边缘 —— 不能走到那一步
    expect(PANEL_RAIL_LABEL_INSET - 3).toBeLessThan(2);
  });

  it("竖排标签左右内缩后仍留得出标签盒（不能把轨道挤空）", () => {
    const labelBoxWidth = PANEL_COLLAPSED_WIDTH - PANEL_RAIL_LABEL_INSET * 2;

    expect(labelBoxWidth).toBe(40);
    expect(labelBoxWidth).toBeGreaterThan(0);
  });

  it("分割线是 flex 子节点，厚度为正", () => {
    // 分割线必须真实占位（不能 absolute 叠在侧栏边缘），
    // 否则压在原生视图上的那部分热区点不动
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
