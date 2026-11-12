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

/* ============================================================
   面板的几何常量
   ============================================================
   主进程拿它们算窗口尺寸，渲染层拿它们排卡片 —— 两边必须是同一份数字。

   之前这些数字各写一份（主进程写 px 常量，渲染层写 Tailwind 类），
   结果差出了两像素：面板的 border 各占 1px，主进程没算进去，
   渲染层扣掉边框后卡片区少 2px，卡片 h-[180px] 溢出一点点。
   加上底部横排容器写的是 overflow-x-auto —— CSS 规定一个轴不是
   visible 时另一个轴的 visible 会被算成 auto —— 面板就多出一条
   竖向滚动条，滚轮一碰内容就错位。

   改这里的值，两边会一起变；只改一边，又会回到今天这个坑。 */

/** 面板本体的边框宽度（渲染层 border 类，1px） */
export const CLIPBOARD_PANEL_BORDER = 1;
/** 卡片区的内边距（渲染层 p-3 = 12px） */
export const CLIPBOARD_PANEL_PADDING = 12;
/** 标题栏高度（渲染层 h-9 = 36px，含它自己的 border-b） */
export const CLIPBOARD_PANEL_HEADER_HEIGHT = 36;
/** 卡片之间的间距（渲染层 gap-2.5 = 10px） */
export const CLIPBOARD_PANEL_CARD_GAP = 10;
/** 底部横排：一张卡片的宽高 */
export const CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH = 232;
export const CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT = 180;
/** 侧边竖排：面板宽度与一张卡片的高度 */
export const CLIPBOARD_PANEL_SIDE_WIDTH = 360;
export const CLIPBOARD_PANEL_SIDE_CARD_HEIGHT = 92;
/**
 * 窗口四周留给面板投影的透明留白
 *
 * 窗口是 transparent 的，面板的投影要画在窗口底子上 —— 不留边的话，
 * 投影落在窗口边界外就被裁掉，面板看着像贴了张纸片。
 * 渲染层用同样的留白扣出面板本体，两边对得上。
 */
export const CLIPBOARD_PANEL_SHADOW_PADDING = 16;

/**
 * 面板本体（不含四周透明留白）的尺寸
 *
 * 「本体」= 渲染层里那个带圆角和边框的面板元素本身，
 * 含它自己的 1px 边框（border-box），不含窗口四周的透明留白。
 */
export function clipboardPanelBodySize(
  position: ClipboardPanelPosition
): { width: number; height: number } {
  const gapTotal = (CLIPBOARD_PANEL_ITEM_COUNT - 1) * CLIPBOARD_PANEL_CARD_GAP;
  if (position === "side") {
    return {
      // 侧边布局的卡片是 w-full，宽度由面板宽度决定，不参与累加
      width: CLIPBOARD_PANEL_SIDE_WIDTH,
      height:
        CLIPBOARD_PANEL_BORDER * 2 +
        CLIPBOARD_PANEL_HEADER_HEIGHT +
        CLIPBOARD_PANEL_PADDING * 2 +
        CLIPBOARD_PANEL_ITEM_COUNT * CLIPBOARD_PANEL_SIDE_CARD_HEIGHT +
        gapTotal,
    };
  }
  return {
    width:
      CLIPBOARD_PANEL_BORDER * 2 +
      CLIPBOARD_PANEL_PADDING * 2 +
      CLIPBOARD_PANEL_ITEM_COUNT * CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH +
      gapTotal,
    height:
      CLIPBOARD_PANEL_BORDER * 2 +
      CLIPBOARD_PANEL_HEADER_HEIGHT +
      CLIPBOARD_PANEL_PADDING * 2 +
      CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT,
  };
}

/** 窗口尺寸 = 面板本体 + 四周的透明留白 */
export function clipboardPanelWindowSize(
  position: ClipboardPanelPosition
): { width: number; height: number } {
  const body = clipboardPanelBodySize(position);
  return {
    width: body.width + CLIPBOARD_PANEL_SHADOW_PADDING * 2,
    height: body.height + CLIPBOARD_PANEL_SHADOW_PADDING * 2,
  };
}

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
