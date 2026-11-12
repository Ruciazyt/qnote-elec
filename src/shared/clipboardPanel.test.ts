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

/**
 * 剪贴板面板的尺寸
 *
 * 这组数字有两个进程在用：主进程拿它算窗口多大，渲染层拿它排卡片。
 * 两边只要有一处对不上，面板就会出现滚动条 —— 而且不是「多一根滚动条」
 * 这么轻描淡写：
 *
 *   渲染层的卡片区是 overflow-x-auto。CSS 规定一个轴不是 visible 时，
 *   另一个轴的 visible 会被计算成 auto —— 于是纵向也跟着能滚。
 *   只要卡片区比内容矮 1px，滚轮一碰，标题栏下面的内容就会整体错位。
 *
 * 之前两边各写各的：主进程算面板高度时漏了面板自身的 1px 边框（上下共 2px），
 * 渲染层扣掉边框后卡片区正好矮 2px —— 底部横排面板里就多出一条竖向滚动条。
 *
 * 所以这里守的不是「某个具体数字」，而是「窗口尺寸与内容尺寸必须严丝合缝」。
 */

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
    // 渲染层把窗口四周的透明留白扣掉，再扣掉面板自己的边框、标题栏、
    // 卡片区的上下内边距，剩下的就是卡片区能用的高度
    const available =
      body.height -
      CLIPBOARD_PANEL_BORDER * 2 -
      CLIPBOARD_PANEL_HEADER_HEIGHT -
      CLIPBOARD_PANEL_PADDING * 2;

    // 差一像素就会冒出竖向滚动条 —— 这条断言就是为那 2px 写的
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
    // 这条守的是「尺寸由条数算出来」这个约定本身：
    // 只要尺寸里写死了条数，改 CLIPBOARD_PANEL_ITEM_COUNT 就会立刻错位
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
