export const ISLAND_COLLAPSED_HEIGHT = 44;

export const ISLAND_STRIP_WIDTH = 44;

export const ISLAND_EXPANDED_WIDTH = 400;

export const ISLAND_EXPANDED_HEIGHT = 480;

export const ISLAND_COLLAPSED_RADIUS = 22;

export const ISLAND_EXPANDED_RADIUS = 26;

export const ISLAND_EXPAND_DURATION = 300;

export const ISLAND_COLLAPSE_DURATION = 220;

export const ISLAND_CONTENT_FADE_DELAY = 100;

export const ISLAND_SNAP_EDGE_DISTANCE = 16;

export const ISLAND_DRAG_THRESHOLD = 4;

export const ISLAND_HOVER_DELAY_MIN = 0;

export const ISLAND_HOVER_DELAY_MAX = 1000;

export const ISLAND_HOVER_DELAY_DEFAULT = 300;

export type IslandPage = "todo" | "clipboard" | "notes" | "ai";

export const ISLAND_PAGES: readonly IslandPage[] = ["todo", "clipboard", "notes", "ai"];

export type IslandExpandTrigger = "click" | "hover";

export type IslandAttachMode = "attached" | "floating";

export type IslandDockEdge = "top" | "left" | "right";

export interface IslandSize {
  width: number;
  height: number;
}

export interface IslandPosition {
  x: number;
  y: number;
}

export interface IslandSettings {
  enabled: boolean;
  expandTrigger: IslandExpandTrigger;
  hoverDelayMs: number;
  attachMode: IslandAttachMode;
  dockEdge: IslandDockEdge;
  position: IslandPosition | null;
  displayId: number | null;
}

export const DEFAULT_ISLAND_SETTINGS: IslandSettings = {
  enabled: true,
  expandTrigger: "click",
  hoverDelayMs: ISLAND_HOVER_DELAY_DEFAULT,
  attachMode: "attached",
  dockEdge: "top",
  position: null,
  displayId: null,
};

export interface IslandSnapshot {
  expanded: boolean;
  page: IslandPage;
  attachMode: IslandAttachMode;
  dockEdge: IslandDockEdge;
  size: IslandSize;
  position: IslandPosition;
}

export interface IslandAiActivity {
  running: boolean;
  title: string;
  sessionId: string | null;
  startedAt: number | null;
  tool: string | null;
}

export interface IslandRecentNote {
  relPath: string;
  name: string;
  mtime: number;
  type: string;
}
