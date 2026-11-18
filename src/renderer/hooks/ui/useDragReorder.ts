import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "@/styles/drag-reorder.css";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  computeGap,
  computeRipples,
  findGapIndex,
  insertAt,
  type DragReorderMode,
  type DragRect,
  type DragSlot,
} from "./dragReorderGeometry";

export type DragReorderItemState = "idle" | "dragged" | "grabbed";

export interface UseDragReorderOptions {
  ids: string[];
  onReorder: (ids: string[]) => void;
  mode?: DragReorderMode;
  columns?: number;
  amplitude?: number;
  liftOffset?: number;
  liftScale?: number;
  disabled?: boolean;
  labelOf?: (id: string) => string;
}

export interface UseDragReorderResult {
  containerRef: (node: HTMLElement | null) => void;
  hintRef: (node: HTMLElement | null) => void;
  registerItem: (id: string) => (node: HTMLElement | null) => void;
  stateOf: (id: string) => DragReorderItemState;
  handleKeyDown: (id: string, event: ReactKeyboardEvent) => void;
  handlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  announcement: string;
}

interface PendingPointer {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
}

interface DragSession {
  id: string;
  pointerId: number;
  originIndex: number;
  startClientX: number;
  startClientY: number;
  baseRect: DragRect;
  slots: DragSlot[];
  gapIndex: number;
  containerLeft: number;
  containerTop: number;
  clientX: number;
  clientY: number;
}

interface RectSnapshot {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DRAG_THRESHOLD = 4;
const DROP_TOLERANCE = 12;

function measureSlots(
  container: HTMLElement,
  items: Map<string, HTMLElement>,
  order: string[],
  excludeId: string | null
): DragSlot[] {
  const bounds = container.getBoundingClientRect();
  const slots: DragSlot[] = [];
  for (const id of order) {
    if (id === excludeId) continue;
    const node = items.get(id);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    slots.push({
      id,
      x: rect.left - bounds.left,
      y: rect.top - bounds.top,
      w: rect.width,
      h: rect.height,
    });
  }
  return slots;
}

function measureSnapshots(
  container: HTMLElement,
  items: Map<string, HTMLElement>
): Map<string, RectSnapshot> {
  const bounds = container.getBoundingClientRect();
  const snapshots = new Map<string, RectSnapshot>();
  for (const [id, node] of items) {
    const rect = node.getBoundingClientRect();
    snapshots.set(id, {
      x: rect.left - bounds.left,
      y: rect.top - bounds.top,
      w: rect.width,
      h: rect.height,
    });
  }
  return snapshots;
}

function stepFor(key: string, mode: DragReorderMode, columns: number): number {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  if (key === "ArrowUp") return mode === "grid" ? -Math.max(1, columns) : -1;
  if (key === "ArrowDown") return mode === "grid" ? Math.max(1, columns) : 1;
  return 0;
}

export function useDragReorder(options: UseDragReorderOptions): UseDragReorderResult {
  const {
    ids,
    onReorder,
    mode = "grid",
    columns = 1,
    amplitude = 10,
    liftOffset = 8,
    liftScale = 0.9,
    disabled = false,
    labelOf,
  } = options;

  const settingsRef = useRef({ mode, columns, amplitude, liftOffset, liftScale, disabled, labelOf });
  settingsRef.current = { mode, columns, amplitude, liftOffset, liftScale, disabled, labelOf };

  const idsRef = useRef(ids);
  idsRef.current = ids;

  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const containerNodeRef = useRef<HTMLElement | null>(null);
  const hintNodeRef = useRef<HTMLElement | null>(null);
  const itemNodesRef = useRef(new Map<string, HTMLElement>());
  const itemCallbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const sessionRef = useRef<DragSession | null>(null);
  const pendingPointerRef = useRef<PendingPointer | null>(null);
  const pendingFlipRef = useRef<Map<string, RectSnapshot> | null>(null);
  const grabbedIdRef = useRef<string | null>(null);
  const grabSnapshotRef = useRef<string[] | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const containerRef = useCallback((node: HTMLElement | null) => {
    containerNodeRef.current = node;
  }, []);

  const hintRef = useCallback((node: HTMLElement | null) => {
    hintNodeRef.current = node;
  }, []);

  const registerItem = useCallback((id: string) => {
    const existing = itemCallbacksRef.current.get(id);
    if (existing) return existing;
    const callback = (node: HTMLElement | null) => {
      if (node) itemNodesRef.current.set(id, node);
      else itemNodesRef.current.delete(id);
    };
    itemCallbacksRef.current.set(id, callback);
    return callback;
  }, []);

  const stateOf = useCallback(
    (id: string): DragReorderItemState => {
      if (activeId === id) return "dragged";
      if (grabbedId === id) return "grabbed";
      return "idle";
    },
    [activeId, grabbedId]
  );

  const applyDragFrame = useCallback((session: DragSession) => {
    const container = containerNodeRef.current;
    if (!container || session.slots.length === 0) return;

    const settings = settingsRef.current;
    const pointerX = session.clientX - session.containerLeft;
    const pointerY = session.clientY - session.containerTop;
    const gapIndex = findGapIndex(session.slots, settings.mode, pointerX, pointerY);
    session.gapIndex = gapIndex;

    const dragged = itemNodesRef.current.get(session.id);
    if (dragged) {
      const liftX = settings.mode === "list" ? settings.liftOffset : 0;
      const liftY = settings.mode === "list" ? 0 : -settings.liftOffset;
      dragged.style.setProperty(
        "--drag-x",
        `${session.clientX - session.startClientX + liftX}px`
      );
      dragged.style.setProperty(
        "--drag-y",
        `${session.clientY - session.startClientY + liftY}px`
      );
    }

    const showLine = gapIndex !== session.originIndex;
    const ripples =
      showLine && !reducedMotionRef.current
        ? computeRipples(session.slots, settings.mode, gapIndex, settings.amplitude)
        : new Map<string, { dx: number; dy: number; delay: number }>();

    for (const [id, node] of itemNodesRef.current) {
      if (id === session.id) continue;
      const ripple = ripples.get(id);
      node.style.setProperty("--drag-x", ripple ? `${ripple.dx}px` : "0px");
      node.style.setProperty("--drag-y", ripple ? `${ripple.dy}px` : "0px");
      node.style.setProperty("--drag-delay", ripple ? `${ripple.delay}ms` : "0ms");
    }

    const hint = hintNodeRef.current;
    if (!hint) return;
    if (!showLine) {
      hint.dataset.active = "false";
      return;
    }
    const gap = computeGap(session.slots, settings.mode, gapIndex);
    if (!gap) return;
    hint.dataset.orientation = gap.orientation;
    hint.dataset.active = "true";
    hint.style.setProperty("--hint-x", `${gap.x}px`);
    hint.style.setProperty("--hint-y", `${gap.y}px`);
    hint.style.setProperty("--hint-length", `${gap.length}px`);
  }, []);

  const refreshContainerBounds = useCallback(() => {
    const session = sessionRef.current;
    const container = containerNodeRef.current;
    if (!session || !container) return;
    const rect = container.getBoundingClientRect();
    session.containerLeft = rect.left;
    session.containerTop = rect.top;
  }, []);

  const beginDrag = useCallback(
    (pending: PendingPointer, clientX: number, clientY: number): boolean => {
      const container = containerNodeRef.current;
      const node = itemNodesRef.current.get(pending.id);
      if (!container || !node) return false;
      const order = idsRef.current;
      const originIndex = order.indexOf(pending.id);
      if (originIndex < 0) return false;

      const bounds = container.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      sessionRef.current = {
        id: pending.id,
        pointerId: pending.pointerId,
        originIndex,
        startClientX: pending.startX,
        startClientY: pending.startY,
        baseRect: {
          x: rect.left - bounds.left,
          y: rect.top - bounds.top,
          w: rect.width,
          h: rect.height,
        },
        slots: [],
        gapIndex: originIndex,
        containerLeft: bounds.left,
        containerTop: bounds.top,
        clientX,
        clientY,
      };
      pendingPointerRef.current = null;

      const scale = settingsRef.current.mode === "row" ? 1 : settingsRef.current.liftScale;
      node.style.setProperty("--lift-scale", String(scale));
      setActiveId(pending.id);
      return true;
    },
    []
  );

  const teardown = useCallback(() => {
    window.removeEventListener("pointermove", handlePointerMoveRef.current);
    window.removeEventListener("pointerup", handlePointerUpRef.current);
    window.removeEventListener("pointercancel", handlePointerUpRef.current);
    window.removeEventListener("keydown", handleWindowKeyDownRef.current);
    window.removeEventListener("scroll", refreshContainerBounds, true);
  }, [refreshContainerBounds]);

  const suppressNextClick = useCallback(() => {
    const swallow = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => {
      window.removeEventListener("click", swallow, { capture: true });
    }, 0);
  }, []);

  const hideHint = useCallback(() => {
    const hint = hintNodeRef.current;
    if (hint) hint.dataset.active = "false";
  }, []);

  const finishDrag = useCallback(
    (session: DragSession, inside: boolean) => {
      hideHint();
      const container = containerNodeRef.current;
      const dragged = itemNodesRef.current.get(session.id);
      const first = container
        ? measureSnapshots(container, itemNodesRef.current)
        : new Map<string, RectSnapshot>();

      if (dragged) dragged.style.setProperty("--lift-scale", "1");
      setActiveId(null);
      pendingFlipRef.current = first;

      if (!inside) return;
      const order = idsRef.current;
      const next = insertAt(order, session.id, session.gapIndex);
      if (next.join("|") === order.join("|")) return;
      onReorderRef.current(next);
    },
    [hideHint]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const pending = pendingPointerRef.current;
      if (pending) {
        if (event.pointerId !== pending.pointerId) return;
        const dx = event.clientX - pending.startX;
        const dy = event.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!beginDrag(pending, event.clientX, event.clientY)) return;
      }

      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      session.clientX = event.clientX;
      session.clientY = event.clientY;
      applyDragFrame(session);
    },
    [applyDragFrame, beginDrag]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      pendingPointerRef.current = null;
      teardown();
      if (!session) return;
      sessionRef.current = null;

      const container = containerNodeRef.current;
      if (container) {
        const bounds = container.getBoundingClientRect();
        session.containerLeft = bounds.left;
        session.containerTop = bounds.top;
        session.gapIndex = findGapIndex(
          session.slots,
          settingsRef.current.mode,
          event.clientX - bounds.left,
          event.clientY - bounds.top
        );
        const inside =
          event.clientX >= bounds.left - DROP_TOLERANCE &&
          event.clientX <= bounds.right + DROP_TOLERANCE &&
          event.clientY >= bounds.top - DROP_TOLERANCE &&
          event.clientY <= bounds.bottom + DROP_TOLERANCE;
        suppressNextClick();
        finishDrag(session, inside);
        return;
      }
      finishDrag(session, false);
    },
    [finishDrag, suppressNextClick, teardown]
  );

  const cancelDrag = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    pendingPointerRef.current = null;
    teardown();
    const container = containerNodeRef.current;
    const dragged = itemNodesRef.current.get(session.id);
    if (dragged) dragged.style.setProperty("--lift-scale", "1");
    hideHint();
    setActiveId(null);
    if (container) pendingFlipRef.current = measureSnapshots(container, itemNodesRef.current);
    suppressNextClick();
  }, [hideHint, suppressNextClick, teardown]);

  const handleWindowKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelDrag();
    },
    [cancelDrag]
  );

  const handlePointerMoveRef = useRef(handlePointerMove);
  handlePointerMoveRef.current = handlePointerMove;
  const handlePointerUpRef = useRef(handlePointerUp);
  handlePointerUpRef.current = handlePointerUp;
  const handleWindowKeyDownRef = useRef(handleWindowKeyDown);
  handleWindowKeyDownRef.current = handleWindowKeyDown;

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (settingsRef.current.disabled) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const holder = target?.closest?.("[data-drag-item-id]") as HTMLElement | null;
      const id = holder?.getAttribute("data-drag-item-id");
      if (!id) return;

      pendingPointerRef.current = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      window.addEventListener("pointermove", handlePointerMoveRef.current);
      window.addEventListener("pointerup", handlePointerUpRef.current);
      window.addEventListener("pointercancel", handlePointerUpRef.current);
      window.addEventListener("keydown", handleWindowKeyDownRef.current);
      window.addEventListener("scroll", refreshContainerBounds, true);
    },
    [refreshContainerBounds]
  );

  const labelText = useCallback(
    (id: string) => {
      const label = settingsRef.current.labelOf?.(id);
      return label ? `「${label}」` : "";
    },
    []
  );

  const startGrab = useCallback(
    (id: string) => {
      grabSnapshotRef.current = [...idsRef.current];
      grabbedIdRef.current = id;
      setGrabbedId(id);
      const node = itemNodesRef.current.get(id);
      if (node) {
        const scale = settingsRef.current.mode === "row" ? 1 : settingsRef.current.liftScale;
        node.style.setProperty("--lift-scale", String(scale));
      }
      setAnnouncement(`已拾取${labelText(id)}，方向键移动，空格放下，Esc 取消`);
    },
    [labelText]
  );

  const releaseGrab = useCallback(() => {
    const id = grabbedIdRef.current;
    if (!id) return;
    grabbedIdRef.current = null;
    setGrabbedId(null);
    const node = itemNodesRef.current.get(id);
    if (node) node.style.setProperty("--lift-scale", "1");
    const order = idsRef.current;
    const index = order.indexOf(id);
    setAnnouncement(`已放下${labelText(id)}，位于第 ${index + 1} 位`);
  }, [labelText]);

  const cancelGrab = useCallback(() => {
    const snapshot = grabSnapshotRef.current;
    const id = grabbedIdRef.current;
    grabbedIdRef.current = null;
    setGrabbedId(null);
    const node = id ? itemNodesRef.current.get(id) : null;
    if (node) node.style.setProperty("--lift-scale", "1");
    if (snapshot) {
      const container = containerNodeRef.current;
      if (container) pendingFlipRef.current = measureSnapshots(container, itemNodesRef.current);
      onReorderRef.current(snapshot);
    }
    setAnnouncement("已取消移动");
  }, []);

  const moveGrabbed = useCallback(
    (delta: number) => {
      const id = grabbedIdRef.current;
      if (!id) return;
      const order = idsRef.current;
      const from = order.indexOf(id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(order.length - 1, from + delta));
      if (to === from) return;
      const container = containerNodeRef.current;
      if (container) pendingFlipRef.current = measureSnapshots(container, itemNodesRef.current);
      onReorderRef.current(insertAt(order, id, to));
      setAnnouncement(`${labelText(id)}移动到第 ${to + 1} 位，共 ${order.length} 位`);
    },
    [labelText]
  );

  const handleKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent) => {
      if (settingsRef.current.disabled) return;
      if (event.target !== event.currentTarget) return;
      const key = event.key;

      if (key === "Escape") {
        event.preventDefault();
        if (grabbedIdRef.current) cancelGrab();
        else cancelDrag();
        return;
      }

      if (key === " " || key === "Enter") {
        event.preventDefault();
        if (grabbedIdRef.current === id) releaseGrab();
        else if (!grabbedIdRef.current) startGrab(id);
        return;
      }

      const delta = stepFor(key, settingsRef.current.mode, settingsRef.current.columns);
      if (delta === 0) return;
      event.preventDefault();
      if (grabbedIdRef.current !== id) {
        startGrab(id);
        return;
      }
      moveGrabbed(delta);
    },
    [cancelDrag, cancelGrab, moveGrabbed, releaseGrab, startGrab]
  );

  useLayoutEffect(() => {
    const session = sessionRef.current;
    if (!activeId || !session || session.id !== activeId) return;
    const container = containerNodeRef.current;
    const node = itemNodesRef.current.get(activeId);
    if (!container || !node) return;

    const bounds = container.getBoundingClientRect();
    session.containerLeft = bounds.left;
    session.containerTop = bounds.top;
    node.style.setProperty("--lift-left", `${session.baseRect.x}px`);
    node.style.setProperty("--lift-top", `${session.baseRect.y}px`);
    node.style.setProperty("--lift-width", `${session.baseRect.w}px`);
    node.style.setProperty("--lift-height", `${session.baseRect.h}px`);
    session.slots = measureSlots(container, itemNodesRef.current, idsRef.current, activeId);
    applyDragFrame(session);
  }, [activeId, applyDragFrame]);

  useLayoutEffect(() => {
    const container = containerNodeRef.current;
    const pending = pendingFlipRef.current;
    if (!container || !pending) return;
    pendingFlipRef.current = null;

    for (const node of itemNodesRef.current.values()) {
      node.style.setProperty("--drag-x", "0px");
      node.style.setProperty("--drag-y", "0px");
      node.style.setProperty("--drag-delay", "0ms");
    }

    const last = measureSnapshots(container, itemNodesRef.current);
    const moved: HTMLElement[] = [];
    for (const [id, node] of itemNodesRef.current) {
      const from = pending.get(id);
      const to = last.get(id);
      if (!from || !to) continue;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      if (dx === 0 && dy === 0) continue;
      node.style.transition = "none";
      node.style.setProperty("--drag-x", `${dx}px`);
      node.style.setProperty("--drag-y", `${dy}px`);
      moved.push(node);
    }

    void container.offsetHeight;

    for (const node of moved) {
      node.style.transition = "";
      node.style.setProperty("--drag-x", "0px");
      node.style.setProperty("--drag-y", "0px");
    }
  });

  useEffect(() => teardown, [teardown]);

  return {
    containerRef,
    hintRef,
    registerItem,
    stateOf,
    handleKeyDown,
    handlePointerDown,
    isDragging: activeId !== null,
    announcement,
  };
}
