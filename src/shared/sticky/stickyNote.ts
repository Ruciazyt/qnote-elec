
export type StickyNoteType = "text" | "image";

export interface StickyHoldPayload {
  type: StickyNoteType;
  content: string;
}

export interface StickyNoteInit {
  id: string;
  type: StickyNoteType;
  text: string;
  imageDataUrl?: string;
  alwaysOnTop: boolean;
  autoSize: boolean;
  width: number;
  height: number;
  createdAt: number;
}

export interface StickyNotePatch {
  id?: string;
  text?: string;
  alwaysOnTop?: boolean;
  autoSize?: boolean;
}

export interface StickyBounds {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  autoSize?: boolean;
}
