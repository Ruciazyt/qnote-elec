
import type { DestructiveDialogSpec } from "./ui-guards";

export const DESTRUCTIVE_DIALOGS: DestructiveDialogSpec[] = [
  { file: "pages/home/clipboard/DeleteAllConfirmDialog.tsx", targetProp: null, label: "清空所有记录" },
  { file: "pages/settings/ClearVectorConfirmDialog.tsx", targetProp: null, label: "清空记忆索引" },
  { file: "pages/apps/RemoveProjectDialog.tsx", targetProp: "name", label: "移除项目" },
];

export const THIN_FOCUS_RING_BASELINE: Record<string, number> = {};

export const HIDDEN_FOCUSABLE_BASELINE: Record<string, number> = {};

export const DESTRUCTIVE_DIALOG_BASELINE: Record<string, number> = {};

export const BRAND_TEXT_BASELINE: Record<string, number> = {};
