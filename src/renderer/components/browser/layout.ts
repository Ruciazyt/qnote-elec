/**
 * 浏览器页侧栏的布局常量
 *
 * 单独成文件：侧栏宽度现在由用户拖拽决定，BrowserPage（算可用宽度上限）、
 * BrowserSidePanel（应用宽度）、useBrowserSidePanel（持久化与钳制）都要用同一份定义。
 */

export type SidePanelView = "bookmarks" | "ai";

/** 默认宽度（用户拖动分割线后可改，改动会持久化） */
export const SIDE_PANEL_DEFAULT_WIDTH = 288;

/** 再窄就没法看了 —— 收藏夹标题、AI 会话列表都是横排文字 */
export const SIDE_PANEL_MIN_WIDTH = 220;

/** 再宽网页就没法看了，和 SIDE_PANEL_MAX_WIDTH 二者取更小的一个 */
export const SIDE_PANEL_MAX_WIDTH = 720;

/** 网页区最小宽度：拖到侧栏再宽，也必须给网页留出这么多 */
export const BROWSER_MIN_WIDTH = 360;

/**
 * 分割线（拖拽热区）的厚度
 *
 * 它作为 flex 兄弟节点真实占位，所以网页区会被压缩这么多 —— 这是有意的：
 * 分割线做成 flex 子节点（而不是 absolute 叠在侧栏左边缘），
 * 才能保证它**完全**落在 DOM 区域内。
 *
 * 这一点很关键：网页由主进程 WebContentsView 承载，是盖在 DOM 之上的原生层，
 * 压在它上面的 DOM 是收不到鼠标事件的。分割线只要有哪怕 1px 伸进网页区，
 * 那部分就点不动了。放成 flex 子节点则彻底避开这个问题。
 */
export const PANEL_RESIZER_WIDTH = 7;

/** 把宽度钳制到可用区间 */
export function clampPanelWidth(
  width: number,
  min: number,
  max: number
): number {
  return Math.min(Math.max(Math.round(width), min), Math.max(min, max));
}
