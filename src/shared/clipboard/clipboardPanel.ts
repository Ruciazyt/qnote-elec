
export type ClipboardPanelPosition = "bottom" | "side";

export const CLIPBOARD_PANEL_POSITIONS: readonly ClipboardPanelPosition[] = ["bottom", "side"];

export const CLIPBOARD_PANEL_ITEM_COUNT = 5;


export const CLIPBOARD_PANEL_BORDER = 1;
export const CLIPBOARD_PANEL_PADDING = 12;
export const CLIPBOARD_PANEL_HEADER_HEIGHT = 36;
export const CLIPBOARD_PANEL_CARD_GAP = 10;
export const CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH = 232;
export const CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT = 180;
export const CLIPBOARD_PANEL_SIDE_WIDTH = 360;
export const CLIPBOARD_PANEL_SIDE_CARD_HEIGHT = 92;
export const CLIPBOARD_PANEL_SHADOW_PADDING = 16;

export function clipboardPanelBodySize(
  position: ClipboardPanelPosition
): { width: number; height: number } {
  const gapTotal = (CLIPBOARD_PANEL_ITEM_COUNT - 1) * CLIPBOARD_PANEL_CARD_GAP;
  if (position === "side") {
    return {
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

export function clipboardPanelWindowSize(
  position: ClipboardPanelPosition
): { width: number; height: number } {
  const body = clipboardPanelBodySize(position);
  return {
    width: body.width + CLIPBOARD_PANEL_SHADOW_PADDING * 2,
    height: body.height + CLIPBOARD_PANEL_SHADOW_PADDING * 2,
  };
}

export const DEFAULT_CLIPBOARD_PANEL_POSITION: ClipboardPanelPosition = "bottom";

export function isClipboardPanelPosition(value: unknown): value is ClipboardPanelPosition {
  return (
    typeof value === "string" &&
    (CLIPBOARD_PANEL_POSITIONS as readonly string[]).includes(value)
  );
}

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
      return /^[a-z0-9]$/i.test(key) ? key.toUpperCase() : key;
    })
    .filter(Boolean)
    .join("+");
}
