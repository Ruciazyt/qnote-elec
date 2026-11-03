/**
 * 剪贴板面板（全局快捷键唤出的浮层）的共享类型与常量
 *
 * 主进程用它决定窗口尺寸与位置，渲染层用它决定卡片排布，
 * 两边必须认同同一份定义 —— 否则会出现「窗口按底部尺寸摆开、
 * 内容却按侧边竖排」这种错位。
 */

/** 面板的展示位置：底部横排 / 侧边竖排 */
export type ClipboardPanelPosition = "bottom" | "side";

/** 合法取值白名单 */
export const CLIPBOARD_PANEL_POSITIONS: readonly ClipboardPanelPosition[] = ["bottom", "side"];

/** 面板展示的记录条数 */
export const CLIPBOARD_PANEL_ITEM_COUNT = 5;

/** 面板位置的默认值 */
export const DEFAULT_CLIPBOARD_PANEL_POSITION: ClipboardPanelPosition = "bottom";

/**
 * 判断一个值是不是合法的面板位置
 *
 * 落库前必须过这一遍：配置值来自数据库，脏数据（比如手工改过库）
 * 会直接决定窗口的尺寸与坐标，非法值会让面板跑到屏幕外或尺寸算崩。
 */
export function isClipboardPanelPosition(value: unknown): value is ClipboardPanelPosition {
  return (
    typeof value === "string" &&
    (CLIPBOARD_PANEL_POSITIONS as readonly string[]).includes(value)
  );
}

/**
 * accelerator 语法里各名字对应的显示写法
 *
 * 存的是 Electron 的写法（Control+Shift+C），直接显示给用户不好认。
 */
const ACCELERATOR_DISPLAY_NAMES: Record<string, string> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  commandorcontrol: "Ctrl",
  cmdorctrl: "Ctrl",
  command: "Cmd",
  cmd: "Cmd",
  super: "Win",
  meta: "Win",
  alt: "Alt",
  option: "Alt",
  altgr: "AltGr",
  shift: "Shift",
  space: "Space",
  escape: "Esc",
  esc: "Esc",
  enter: "Enter",
  return: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  tab: "Tab",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  plus: "+",
};

/**
 * 把 accelerator 语法转成人看的写法
 *
 * "Control+Shift+C" → "Ctrl+Shift+C"，"F1" → "F1"，"escape" → "Esc"。
 * macOS 上 CommandOrControl 会被显示成 Cmd（那才是用户实际按下的键）。
 */
export function formatAccelerator(accelerator: string): string {
  if (!accelerator) return "";
  const isMac = typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

  return accelerator
    .split("+")
    .map((part) => {
      const key = part.trim();
      if (!key) return "";
      const lower = key.toLowerCase();
      if (lower === "commandorcontrol" || lower === "cmdorctrl") {
        return isMac ? "Cmd" : "Ctrl";
      }
      const alias = ACCELERATOR_DISPLAY_NAMES[lower];
      if (alias) return alias;
      // 单个字母统一大写；F1~F24 本身已是这个形式
      return /^[a-z0-9]$/i.test(key) ? key.toUpperCase() : key;
    })
    .filter(Boolean)
    .join("+");
}
