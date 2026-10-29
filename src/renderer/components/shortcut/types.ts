/**
 * 主页快捷方式的跨进程类型定义
 *
 * 与主进程 shortcutHandlers / shortcutIcons 中的定义严格对应。
 */

export type ShortcutKind = "url" | "app" | "folder";

/** 一条快捷方式 — 与 shortcut 表一一对应 */
export interface ShortcutRow {
  id: number;
  kind: ShortcutKind;
  /** URL 或绝对路径 */
  target: string;
  title: string;
  sort_order: number;
}

/** 系统选择器 / 归一化之后的一条待添加快捷方式 */
export interface ShortcutPickResult {
  kind: ShortcutKind;
  target: string;
  title: string;
}

/** 系统右键菜单项的注册状态 */
export interface ShellMenuStatus {
  supported: boolean;
  enabled: boolean;
  /**
   * 注册的命令是否指向当前这个应用
   *
   * enabled 只说明"注册项在"，valid 才说明"右键点下去真的有用"。
   * 两者不一致时菜单项会显示出来但点了没反应 —— 界面必须如实显示，
   * 不能拿 enabled 当成"一切正常"给用户一个绿灯。
   */
  valid: boolean;
  /** 实际注册的命令，供展示与排查 */
  command?: string;
  /** supported 为假时的原因，直接展示给用户 */
  reason?: string;
}

/** 收起态面板的宽度 —— 收起到只剩一条竖排标签 */
export const SHORTCUT_PANEL_WIDTH = 236;
export const SHORTCUT_PANEL_COLLAPSED_WIDTH = 44;
