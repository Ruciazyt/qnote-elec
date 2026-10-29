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

/** 长按生成便签时随行携带的载荷 —— 只带够画一张便签的东西 */
export interface StickyHoldPayload {
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
  /**
   * 尺寸是否随内容自适应
   *
   * true 时，窗口大小由渲染层量出正文实际占位后申请（正好包住内容）；
   * 用户一旦拖动过缩放手柄，就转成 false —— 手动尺寸优先，
   * 否则用户刚拖大的纸会被下一次内容变化又缩回去。
   */
  autoSize: boolean;
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
  /** 切换尺寸模式：true = 随内容自适应，false = 用用户手动定的尺寸 */
  autoSize?: boolean;
}

/** 便签位置 / 尺寸 */
export interface StickyBounds {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /**
   * 顺带切尺寸模式
   *
   * 缩放手柄拖动时一并传 false —— 尺寸和模式在同一次调用里改，
   * 免得出现"窗口已经按手动尺寸变了、模式还停在自适应"的中间态，
   * 那一瞬间内容变化就会把用户刚拖出来的尺寸又缩回去。
   */
  autoSize?: boolean;
}
