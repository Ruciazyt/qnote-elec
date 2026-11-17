
export const PANEL_RESIZER_WIDTH = 7;

export const PANEL_COLLAPSED_WIDTH = 48;

export const PANEL_COLLAPSED_BUTTON_SIZE = 32;

export const PANEL_COLLAPSED_BUTTON_INSET = 8;

export const PANEL_HEADER_PADDING_X = 8;

export const PANEL_RAIL_LABEL_INSET = 4;

export function clampPanelWidth(
  width: number,
  min: number,
  max: number
): number {
  return Math.min(Math.max(Math.round(width), min), Math.max(min, max));
}
