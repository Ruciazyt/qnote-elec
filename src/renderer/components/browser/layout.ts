/**
 * 浏览器页侧栏的布局常量
 *
 * 单独成文件：侧栏宽度现在由用户拖拽决定，BrowserPage（算可用宽度上限）、
 * BrowserSidePanel（应用宽度）、useBrowserSidePanel（持久化与钳制）都要用同一份定义。
 */

/**
 * 分割线厚度与宽度钳制已经不止浏览器页在用（笔记页、应用管理页都用同一套），
 * 所以实现在 @/components/panel/layout —— 这里转出，既有调用点不用改。
 */
export { PANEL_RESIZER_WIDTH, clampPanelWidth } from "@/components/panel/layout";

export type SidePanelView = "bookmarks" | "ai";

/** 默认宽度（用户拖动分割线后可改，改动会持久化） */
export const SIDE_PANEL_DEFAULT_WIDTH = 288;

/** 再窄就没法看了 —— 收藏夹标题、AI 会话列表都是横排文字 */
export const SIDE_PANEL_MIN_WIDTH = 220;

/** 再宽网页就没法看了，和 SIDE_PANEL_MAX_WIDTH 二者取更小的一个 */
export const SIDE_PANEL_MAX_WIDTH = 720;

/** 网页区最小宽度：拖到侧栏再宽，也必须给网页留出这么多 */
export const BROWSER_MIN_WIDTH = 360;
