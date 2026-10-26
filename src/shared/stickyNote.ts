/**
 * 屏幕便签（sticky note）—— 主进程与渲染层共享的类型
 *
 * ## 为什么单独放 shared
 *
 * 便签有两条链路：
 *   - 主进程建窗口、管位置、管持久化
 *   - 渲染层画便签、画拖拽预览
 * 两边都要用同一套"便签长什么样"的定义（类型、配色、载荷形状），
 * 放在 shared 里改一处两边同时生效，不会出现"主进程认为有颜色、
 * 渲染层没画出来"这种对不上的状态。
 */

/** 便签内容类型：文本 / 图片 */
export type StickyNoteType = "text" | "image";

/** 拖出窗口时随行携带的载荷 —— 只带够画一张便签的东西 */
export interface StickyDragPayload {
  type: StickyNoteType;
  /** 文本内容，或图片的 data URL */
  content: string;
}

/** 便签窗口初始化数据（主进程 → 渲染层） */
export interface StickyNoteInit {
  id: string;
  type: StickyNoteType;
  /** 文本便签的正文；图片便签为空串 */
  text: string;
  /**
   * 图片便签的 data URL
   *
   * 图片在主进程落成文件持久化，但**发给渲染层的是 data URL** ——
   * 开发环境下页面跑在 http://localhost:5173，渲染层直接引 file:// 图片
   * 会被 Chromium 的本地文件访问策略挡掉（开发环境表现为图片一片空白，
   * 打包后才"好了"，极难定位）。走 IPC 传 data URL 与图片来源无关。
   */
  imageDataUrl?: string;
  /** 是否处于"屏幕级"置顶（压在所有窗口之上） */
  alwaysOnTop: boolean;
  /** 便签当前尺寸（渲染层缩放手柄要以此为基准） */
  width: number;
  height: number;
  createdAt: number;
}

/** 便签可被修改的字段 */
export interface StickyNotePatch {
  id?: string;
  text?: string;
  alwaysOnTop?: boolean;
}

/** 便签位置 / 尺寸 */
export interface StickyBounds {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
