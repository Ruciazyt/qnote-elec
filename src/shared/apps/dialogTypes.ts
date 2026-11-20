export type DialogType = "publish" | "start-confirm";

export interface DialogContext {
  type: DialogType;
  payload: Record<string, unknown>;
}

export interface DialogMessage {
  action: string;
  payload?: Record<string, unknown>;
}

export const DIALOG_CLOSE_ACTIONS = ["cancelled", "published", "closed"];
