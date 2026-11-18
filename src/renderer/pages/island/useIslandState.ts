import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ISLAND_SETTINGS,
  ISLAND_DRAG_THRESHOLD,
  type IslandAttachMode,
  type IslandDockEdge,
  type IslandPage,
  type IslandSettings,
} from "@shared/island/island";

export interface IslandController {
  expanded: boolean;
  page: IslandPage;
  attachMode: IslandAttachMode;
  dockEdge: IslandDockEdge;
  settings: IslandSettings;
  setPage: (page: IslandPage) => void;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
  updateSettings: (patch: Partial<IslandSettings>) => Promise<void>;
}

export function useIslandState(): IslandController {
  const [expanded, setExpanded] = useState(false);
  const [page, setPageState] = useState<IslandPage>("clipboard");
  const [attachMode, setAttachMode] = useState<IslandAttachMode>("attached");
  const [dockEdge, setDockEdge] = useState<IslandDockEdge>("top");
  const [settings, setSettings] = useState<IslandSettings>(DEFAULT_ISLAND_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    void window.electron
      .islandGetSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setDockEdge(value.dockEdge);
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return window.electron.onIslandState((state) => {
      setExpanded(state.expanded);
      setPageState(state.page);
      setAttachMode(state.attachMode);
      setDockEdge(state.dockEdge);
    });
  }, []);

  const setPage = useCallback((next: IslandPage) => {
    setPageState(next);
    window.electron.islandSetPage(next);
  }, []);

  const expand = useCallback(() => {
    setExpanded(true);
    window.electron.islandExpand();
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
    window.electron.islandCollapse();
  }, []);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
    window.electron.islandToggle();
  }, []);

  const updateSettings = useCallback(async (patch: Partial<IslandSettings>) => {
    const next = await window.electron.islandSetSettings(patch);
    setSettings(next);
  }, []);

  return {
    expanded,
    page,
    attachMode,
    dockEdge,
    settings,
    setPage,
    expand,
    collapse,
    toggle,
    updateSettings,
  };
}

const MIN_SEND_INTERVAL = 8;

export function useIslandDrag(onClick: () => void) {
  const startRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const draggingRef = useRef(false);
  const pressingRef = useRef(false);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastSentAtRef = useRef(0);

  const flush = useCallback(() => {
    frameRef.current = null;
    const point = pendingRef.current;
    pendingRef.current = null;
    if (!point) return;
    lastSentAtRef.current = Date.now();
    window.electron.islandDragMove(point.x, point.y);
  }, []);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    draggingRef.current = false;
    pressingRef.current = true;
    startRef.current = { x: event.screenX, y: event.screenY, moved: false };
  }, []);

  const endDrag = useCallback(() => {
    pressingRef.current = false;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.electron.islandDragEnd();
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      if (!start.moved) {
        const dx = event.screenX - start.x;
        const dy = event.screenY - start.y;
        if (Math.hypot(dx, dy) < ISLAND_DRAG_THRESHOLD) return;
        start.moved = true;
        draggingRef.current = true;
        window.electron.islandDragStart(start.x, start.y);
      }
      pendingRef.current = { x: event.screenX, y: event.screenY };

      const now = Date.now();
      if (now - lastSentAtRef.current >= MIN_SEND_INTERVAL) {
        lastSentAtRef.current = now;
        cancelFrame();
        flush();
        return;
      }

      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(flush);
      }
    },
    [cancelFrame, flush]
  );

  const onPointerUp = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    pressingRef.current = false;
    cancelFrame();
    if (!start) return;
    if (start.moved) {
      cancelFrame();
      flush();
      endDrag();
      return;
    }
    pendingRef.current = null;
    onClick();
  }, [endDrag, onClick, flush, cancelFrame]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, endDrag, pressingRef };
}
