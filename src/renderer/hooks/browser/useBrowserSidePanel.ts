import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  clampPanelWidth,
  type SidePanelView,
} from "@/pages/browser/layout";

const VIEW_KEY = "qnote-browser-side-panel";
const WIDTH_KEY = "qnote-browser-side-panel-width";

function loadView(): SidePanelView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw === "bookmarks" || raw === "ai" ? raw : null;
  } catch {
    return null;
  }
}

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return SIDE_PANEL_DEFAULT_WIDTH;
    return clampPanelWidth(raw, SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH);
  } catch {
    return SIDE_PANEL_DEFAULT_WIDTH;
  }
}

export function useBrowserSidePanel(): {
  view: SidePanelView | null;
  setView: Dispatch<SetStateAction<SidePanelView | null>>;
  width: number;
  setWidth: (width: number, maxWidth?: number) => void;
  resetWidth: () => void;
} {
  const [view, setView] = useState<SidePanelView | null>(loadView);
  const [width, setWidthState] = useState<number>(loadWidth);

  useEffect(() => {
    try {
      if (view) localStorage.setItem(VIEW_KEY, view);
      else localStorage.removeItem(VIEW_KEY);
    } catch {
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
    }
  }, [width]);

  const setWidth = useCallback((next: number, maxWidth?: number) => {
    setWidthState(() =>
      clampPanelWidth(
        next,
        SIDE_PANEL_MIN_WIDTH,
        Math.min(SIDE_PANEL_MAX_WIDTH, maxWidth ?? SIDE_PANEL_MAX_WIDTH)
      )
    );
  }, []);

  const resetWidth = useCallback(() => {
    setWidthState(
      clampPanelWidth(SIDE_PANEL_DEFAULT_WIDTH, SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH)
    );
  }, []);

  return { view, setView, width, setWidth, resetWidth };
}
