/**
 * 面板布局的通用常量与工具
 *
 * ## 为什么从 browser/layout.ts 拆出来
 *
 * 拖拽分割线与宽度钳制一开始只在浏览器页用，后来笔记页、应用管理页
 * 都接上了同一套 —— 它们是**通用件**，放在 browser/ 目录里只是历史原因。
 * 这里给它们一个中立的家，browser/layout.ts 仍然转出这两个符号，
 * 既有调用点（BrowserPage / NotesPage / useBrowserSidePanel / useNoteSidebarWidth）
 * 不用跟着改。
 */

/**
 * 分割线（拖拽热区）的厚度
 *
 * 它作为 flex 兄弟节点真实占位，所以旁边的内容区会被压缩这么多 —— 这是有意的：
 * 分割线做成 flex 子节点（而不是 absolute 叠在侧栏左边缘），
 * 才能保证它**完全**落在 DOM 区域内。
 *
 * 这一点很关键：网页由主进程 WebContentsView 承载，是盖在 DOM 之上的原生层，
 * 压在它上面的 DOM 是收不到鼠标事件的。分割线只要有哪怕 1px 伸进网页区，
 * 那部分就点不动了。放成 flex 子节点则彻底避开这个问题。
 */
export const PANEL_RESIZER_WIDTH = 7;

/**
 * 折叠态侧栏的几何规则
 *
 * 笔记页、题单页、快捷方式面板、应用管理页共用这一套数 —— 折叠后
 * 它们都是同一种东西：一条窄轨道，轨道里放一个切换按钮。
 *
 * 这套数解决三件事：
 *
 * 1. 折叠轨里按钮**左右留白相等**（≥4px），focus 描边不会被轨道裁掉；
 * 2. 折叠↔展开切换时按钮**横向零位移** —— 同一个按钮落在同一个 x 上，
 *    面板在它旁边变宽变窄，按钮自己不动；
 * 3. 四个页面的折叠轨道是**同一套几何**，不再各写各的 40 / 44。
 *
 * ## 数字怎么来的
 *
 *   轨道外宽 48px（其中 1px 是分隔边框 → 内容盒 47px）
 *   折叠按钮 32×32，固定锚在轨道左起 8px
 *   → 8 + 32 + 8 = 48，按钮正好落在轨道正中，左右各留 8px
 *   → focus 描边向外扩 1px 之后还剩 7px 余量，四边完整可见
 *
 *   展开态头部左内边距同样取 8px（PANEL_HEADER_PADDING_X），
 *   于是两态里按钮都落在 8..40，切换时横向零位移。
 *
 * ## 两个必须避开的坑
 *
 * - 折叠态**不要**用 `justify-center` 居中：轨道带 1px 分隔边框，
 *   内容盒只有 47px，居中会算出 7.5px 的小数偏移，左右留白变成 7.5 / 8.5。
 *   要居中就用**固定 padding 锚定**（PANEL_COLLAPSED_BUTTON_INSET）。
 * - 折叠态的 **gap 必须是 0**：标题与操作区虽然宽度归零（w-0），gap 照样占位，
 *   会把按钮整体往左挤 —— 这正是「按钮贴住轨道左缘、focus 描边左侧被裁掉」的成因。
 */
export const PANEL_COLLAPSED_WIDTH = 48;

/** 折叠态切换按钮的边长（方形按钮） */
export const PANEL_COLLAPSED_BUTTON_SIZE = 32;

/**
 * 折叠态按钮距轨道左缘的距离（固定锚点）
 *
 * 与 PANEL_HEADER_PADDING_X 必须相等 —— 两态共用同一个左缘，
 * 按钮切换时才会横向零位移。
 */
export const PANEL_COLLAPSED_BUTTON_INSET = 8;

/**
 * 展开态面板头部的左右内边距
 *
 * 取值与 PANEL_COLLAPSED_BUTTON_INSET 相同（8px）：折叠态按钮左缘 8px、
 * 展开态按钮左缘 8px，切换时按钮不横移。头部标题与操作区跟在按钮后面，
 * 按钮与标题同处一行、同一条基线。
 */
export const PANEL_HEADER_PADDING_X = 8;

/** 把宽度钳制到可用区间 */
export function clampPanelWidth(
  width: number,
  min: number,
  max: number
): number {
  return Math.min(Math.max(Math.round(width), min), Math.max(min, max));
}
