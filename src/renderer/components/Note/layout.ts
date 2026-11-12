/**
 * 笔记页侧栏（文件树）的布局常量
 *
 * 单独成文件的理由和浏览器页的 layout.ts 一样：宽度由用户拖拽决定后，
 * NotesPage（算可用上限、应用宽度）、useNoteSidebarWidth（持久化与钳制）
 * 需要共用同一份定义，不能各写各的魔法数字。
 */

import { PANEL_COLLAPSED_WIDTH } from "@/components/panel/layout";

/** 默认宽度 —— 沿用改造前的 w-72（18rem = 288px），首次打开观感不变 */
export const NOTE_SIDEBAR_DEFAULT_WIDTH = 288;

/** 再窄文件行就读不出文件名了（文件名 + 类型 + 时间 + 操作按钮挤在一行） */
export const NOTE_SIDEBAR_MIN_WIDTH = 220;

/** 再宽编辑器就没法看了，和 NOTE_SIDEBAR_MAX_WIDTH 二者取更小的一个 */
export const NOTE_SIDEBAR_MAX_WIDTH = 560;

/** 编辑区最小宽度：拖到侧栏再宽，也必须给右栏留出这么多 */
export const NOTES_EDITOR_MIN_WIDTH = 420;

/* ============================================================
 * 侧栏里的上下分栏：笔记树（上） + 外部文件夹（下）
 * ============================================================ */

/**
 * 外部文件夹区默认占的高度比例
 *
 * 0.4 = 笔记树 6 : 外部文件夹 4（用户定的默认值）。
 * 用比例而不是像素：两块共享同一个容器，窗口一变高，像素值立刻过时。
 */
export const NOTES_SPLIT_DEFAULT_RATIO = 0.4;

/** 再小外部区只剩一条缝，目录树没法看 */
export const NOTES_SPLIT_MIN_RATIO = 0.15;

/** 再大笔记树被挤没 */
export const NOTES_SPLIT_MAX_RATIO = 0.7;

/**
 * 外部区收起时的高度
 *
 * 收起后只剩标题行（h-7 = 28px）+ 容器上下内边距（py-1.5 = 12px）。
 *
 * 这个数是写死的，所以改标题行高度或内边距时必须回来改它 ——
 * 差几像素不会报错，只会让收起态的底部多露一条缝或多压掉一点。
 */
export const NOTES_EXTERNAL_COLLAPSED_HEIGHT = 40;

/**
 * 外部区收起 / 展开的时长
 *
 * 退场比入场短（150 / 220）：收起是用户明确不要这块内容了，
 * 慢吞吞地缩回去会让人等；展开是用户要看到东西，值得铺开。
 * 口径见 DESIGN.md「Motion」。
 */
export const NOTES_EXTERNAL_COLLAPSE_MS = 150;
export const NOTES_EXTERNAL_EXPAND_MS = 220;

/**
 * 侧栏收起后的固定宽度
 *
 * 不写死数字，直接取通用面板件那一份（panel/layout.ts）：
 * 笔记页、题单页、快捷方式面板、应用管理页的折叠轨道是同一套几何，
 * 这里再抄一个 40 就会和别的页面差出 8px，折叠轨宽窄不一。
 *
 * 折叠轨里只放一个 32×32 的切换按钮，锚在左起 8px（PANEL_COLLAPSED_BUTTON_INSET）：
 * 8 + 32 + 8 = 48，按钮正好落在轨道正中，左右各留 8px，focus 描边不会被裁。
 */
export const NOTE_SIDEBAR_COLLAPSED_WIDTH = PANEL_COLLAPSED_WIDTH;
