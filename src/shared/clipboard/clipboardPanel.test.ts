// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CLIPBOARD_PANEL_BORDER,
  CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT,
  CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH,
  CLIPBOARD_PANEL_CARD_GAP,
  CLIPBOARD_PANEL_HEADER_HEIGHT,
  CLIPBOARD_PANEL_ITEM_COUNT,
  CLIPBOARD_PANEL_PADDING,
  CLIPBOARD_PANEL_SHADOW_PADDING,
  CLIPBOARD_PANEL_SIDE_CARD_HEIGHT,
  clipboardPanelBodySize,
  clipboardPanelWindowSize,
} from "./clipboardPanel";


describe("剪贴板面板尺寸", () => {
  it("窗口尺寸 = 面板本体 + 四周透明留白", () => {
    for (const position of ["bottom", "side"] as const) {
      const body = clipboardPanelBodySize(position);
      const win = clipboardPanelWindowSize(position);
      expect(win.width).toBe(body.width + CLIPBOARD_PANEL_SHADOW_PADDING * 2);
      expect(win.height).toBe(body.height + CLIPBOARD_PANEL_SHADOW_PADDING * 2);
    }
  });

  it("底部横排：卡片区可用高度恰好等于一张卡片的高度，不多不少", () => {
    const body = clipboardPanelBodySize("bottom");
    const available =
      body.height -
      CLIPBOARD_PANEL_BORDER * 2 -
      CLIPBOARD_PANEL_HEADER_HEIGHT -
      CLIPBOARD_PANEL_PADDING * 2;

    expect(available).toBe(CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT);
  });

  it("侧边竖排：卡片区可用高度恰好等于 5 张卡片加间隙的总高", () => {
    const body = clipboardPanelBodySize("side");
    const available =
      body.height -
      CLIPBOARD_PANEL_BORDER * 2 -
      CLIPBOARD_PANEL_HEADER_HEIGHT -
      CLIPBOARD_PANEL_PADDING * 2;

    const needed =
      CLIPBOARD_PANEL_ITEM_COUNT * CLIPBOARD_PANEL_SIDE_CARD_HEIGHT +
      (CLIPBOARD_PANEL_ITEM_COUNT - 1) * CLIPBOARD_PANEL_CARD_GAP;

    expect(available).toBe(needed);
  });

  it("底部横排：卡片区可用宽度恰好等于 5 张卡片加间隙的总宽", () => {
    const body = clipboardPanelBodySize("bottom");
    const available = body.width - CLIPBOARD_PANEL_BORDER * 2 - CLIPBOARD_PANEL_PADDING * 2;

    const needed =
      CLIPBOARD_PANEL_ITEM_COUNT * CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH +
      (CLIPBOARD_PANEL_ITEM_COUNT - 1) * CLIPBOARD_PANEL_CARD_GAP;

    expect(available).toBe(needed);
  });

  it("改条数时尺寸跟着变，不会出现「窗口按 5 条算、内容却是 6 条」", () => {
    const body = clipboardPanelBodySize("bottom");
    const perCard =
      (body.width -
        CLIPBOARD_PANEL_BORDER * 2 -
        CLIPBOARD_PANEL_PADDING * 2 -
        (CLIPBOARD_PANEL_ITEM_COUNT - 1) * CLIPBOARD_PANEL_CARD_GAP) /
      CLIPBOARD_PANEL_ITEM_COUNT;

    expect(perCard).toBe(CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH);
  });
});
