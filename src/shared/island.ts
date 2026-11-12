/**
 * 灵动岛（Dynamic Island）—— 主进程与渲染层共用的契约
 *
 * 形态参考 fly-island：一个透明置顶窗口贴在屏幕顶边，
 * 收起时是一颗胶囊（只显示一行摘要），展开时是一块带页签的面板。
 *
 * 这里只放**主进程和渲染层都要知道**的东西：
 * 尺寸档位、页签枚举、配置项形状、IPC 载荷类型。
 * 真正的窗口逻辑在 src/main/core/window/island.ts，
 * 界面在 src/renderer/components/island/。
 */

// ── 尺寸档位 ────────────────────────────────────────────────────────────────

/** 收起态高度。胶囊就是这一条高，宽度随摘要文字长度变 */
export const ISLAND_COLLAPSED_HEIGHT = 44;

/**
 * 收起态宽度下限 —— 摘要再短也不能缩成一颗扣子
 *
 * 胶囊的固定部分（四个模块按钮 + 展开箭头 + 内边距）约 174px，
 * 下限定 220 意味着摘要至少有 46px 的位置，同时两侧的透明留白不至于太宽。
 */
export const ISLAND_COLLAPSED_MIN_WIDTH = 220;

/** 收起态宽度上限 —— 摘要再长也不能顶满屏幕 */
export const ISLAND_COLLAPSED_MAX_WIDTH = 460;

/** 展开态面板尺寸 */
export const ISLAND_EXPANDED_WIDTH = 400;
export const ISLAND_EXPANDED_HEIGHT = 480;

/**
 * 窗口比卡片多出来的那一圈 —— 专门留给阴影
 *
 * 岛的阴影是 CSS 的 box-shadow，它画在卡片**外面**：
 * 收起态的胶囊阴影往下探出约 20px，左右各探出约 4px。
 * 而窗口原本跟卡片一样大 —— 阴影画出去的部分被窗口矩形裁掉，
 * 底角就变成两条硬边（看着像直角阴影）。
 *
 * 所以窗口要比卡片大一圈，把阴影完整放出来。
 * 多出来的这圈是透明的，鼠标要能穿过去 —— 见 setInteractive。
 *
 * 展开态的面板不画阴影，所以这圈留白对它是纯浪费 ——
 * 但窗口尺寸是常量，不能按状态变（补间途中换尺寸会把动画撕开）。
 */
export const ISLAND_SHADOW_PAD_X = 10;
export const ISLAND_SHADOW_PAD_Y = 32;

/** 收起态圆角（胶囊）；展开态用 ISLAND_EXPANDED_RADIUS */
export const ISLAND_COLLAPSED_RADIUS = 22;
export const ISLAND_EXPANDED_RADIUS = 26;

// ── 动效 ────────────────────────────────────────────────────────────────────

/**
 * 展开时长（ms）
 *
 * 曲线用 DESIGN.md 那条 cubic-bezier(0.22, 1, 0.36, 1)（≈ easeOutQuint）——
 * 不回弹。早期版本用 easeOutBack，窗口尺寸会冲过目标再荡回来，
 * 边界那一下的抖动就是它带的。
 */
export const ISLAND_EXPAND_DURATION = 300;

/** 收起时长（ms）—— 比展开快，收尾动作要干脆 */
export const ISLAND_COLLAPSE_DURATION = 220;

/** 面板内容相对展开动画的延迟（ms）—— 先让外形稳住，再放内容进来 */
export const ISLAND_CONTENT_FADE_DELAY = 100;

// ── 交互 ────────────────────────────────────────────────────────────────────

/** 拖动时距顶边多少像素内吸附回贴顶 */
export const ISLAND_SNAP_TOP_DISTANCE = 16;

/** 位移小于这个值算点击而不是拖动 */
export const ISLAND_DRAG_THRESHOLD = 4;

/** 悬停展开的延迟区间（ms） */
export const ISLAND_HOVER_DELAY_MIN = 0;
export const ISLAND_HOVER_DELAY_MAX = 1000;
export const ISLAND_HOVER_DELAY_DEFAULT = 300;

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 岛上的四个页签 */
export type IslandPage = "todo" | "clipboard" | "notes" | "ai";

export const ISLAND_PAGES: readonly IslandPage[] = ["todo", "clipboard", "notes", "ai"];

/** 展开方式：点击胶囊，或光标悬停 */
export type IslandExpandTrigger = "click" | "hover";

/**
 * 贴顶还是浮在别处
 *
 * attached —— 顶边与屏幕上沿齐平，两侧顶端是直角（岛挂在屏幕边上）
 * floating —— 被拖到别处，四角一样圆，胶囊是颗药丸
 */
export type IslandAttachMode = "attached" | "floating";

export interface IslandSize {
  width: number;
  height: number;
}

export interface IslandPosition {
  x: number;
  y: number;
}

/** 岛的配置（落在主进程，渲染层只读 + 改） */
export interface IslandSettings {
  /** 总开关。关掉之后最小化回落到原生最小化 */
  enabled: boolean;
  /** 展开方式 */
  expandTrigger: IslandExpandTrigger;
  /** 悬停展开的等待时长（ms），仅 expandTrigger 为 hover 时有意义 */
  hoverDelayMs: number;
  /** 贴顶还是浮着 */
  attachMode: IslandAttachMode;
  /**
   * 卡片左上角的屏幕坐标
   *
   * 两种模式都记：贴顶时纵向会被拉回工作区上沿，横向保留用户放的位置。
   * 为 null 表示「默认居中」。
   */
  position: IslandPosition | null;
  /**
   * 岛所在的显示器 id
   *
   * 岛不跟着鼠标换屏 —— 放哪块屏就留在哪块屏，
   * 拔掉那块屏之后自动回主屏（见 core/window/island.ts 的 findDisplayById）。
   */
  displayId: number | null;
}

export const DEFAULT_ISLAND_SETTINGS: IslandSettings = {
  enabled: true,
  expandTrigger: "click",
  hoverDelayMs: ISLAND_HOVER_DELAY_DEFAULT,
  attachMode: "attached",
  position: null,
  displayId: null,
};

/** 岛的当前状态快照 —— 主进程算完发给渲染层 */
export interface IslandSnapshot {
  expanded: boolean;
  page: IslandPage;
  attachMode: IslandAttachMode;
  size: IslandSize;
  position: IslandPosition;
}

/** AI 任务状态 —— 岛上的「Agent 状态灯」那一页 */
export interface IslandAiActivity {
  /** 有没有正在跑的 AI 任务 */
  running: boolean;
  /** 任务标题（用户那句提问，截断过） */
  title: string;
  /** 会话 id —— 用来终止这一轮 */
  sessionId: string | null;
  /** 开始时间戳（ms） */
  startedAt: number | null;
  /** 正在调用的工具名，没有则 null */
  tool: string | null;
}

/** 最近编辑的笔记条目 */
export interface IslandRecentNote {
  relPath: string;
  name: string;
  /** 修改时间戳（ms） */
  mtime: number;
  type: string;
}
