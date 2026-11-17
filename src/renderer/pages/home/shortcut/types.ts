
export type ShortcutKind = "url" | "app" | "folder";

export interface ShortcutRow {
  id: number;
  kind: ShortcutKind;
  target: string;
  title: string;
  sort_order: number;
}

export interface ShortcutPickResult {
  kind: ShortcutKind;
  target: string;
  title: string;
}

export interface ShellMenuStatus {
  supported: boolean;
  enabled: boolean;
  valid: boolean;
  command?: string;
  reason?: string;
}

export const SHORTCUT_PANEL_WIDTH = 236;

export { PANEL_COLLAPSED_WIDTH as SHORTCUT_PANEL_COLLAPSED_WIDTH } from "@/components/panel/layout";
