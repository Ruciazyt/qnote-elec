/**
 * 笔记页侧栏（文件树）的布局常量
 *
 * 单独成文件的理由和浏览器页的 layout.ts 一样：宽度由用户拖拽决定后，
 * NotesPage（算可用上限、应用宽度）、useNoteSidebarWidth（持久化与钳制）
 * 需要共用同一份定义，不能各写各的魔法数字。
 */

/** 默认宽度 —— 沿用改造前的 w-72（18rem = 288px），首次打开观感不变 */
export const NOTE_SIDEBAR_DEFAULT_WIDTH = 288;

/** 再窄文件行就读不出文件名了（文件名 + 类型 + 时间 + 操作按钮挤在一行） */
export const NOTE_SIDEBAR_MIN_WIDTH = 220;

/** 再宽编辑器就没法看了，和 NOTE_SIDEBAR_MAX_WIDTH 二者取更小的一个 */
export const NOTE_SIDEBAR_MAX_WIDTH = 560;

/** 编辑区最小宽度：拖到侧栏再宽，也必须给右栏留出这么多 */
export const NOTES_EDITOR_MIN_WIDTH = 420;

/**
 * 侧栏收起后的固定宽度（w-10）
 *
 * 单独提出来是因为展开/收起都要用它，写死 w-10 容易被漏改。
 */
export const NOTE_SIDEBAR_COLLAPSED_WIDTH = 40;
