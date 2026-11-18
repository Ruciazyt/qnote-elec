import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IslandPage } from "@shared/island/island";
import { IslandCollapsedBar } from "./IslandCollapsedBar";
import { IslandPanel } from "./IslandPanel";
import { useIslandData } from "./useIslandData";
import { useIslandDrag, useIslandState } from "./useIslandState";
import { TodoPanel } from "./panels/TodoPanel";
import { ClipboardPanel } from "./panels/ClipboardPanel";
import { NotesPanel } from "./panels/NotesPanel";
import { AiChatPanel } from "./panels/AiChatPanel";

const HOVER_LEAVE_DELAY = 400;
const TOAST_DURATION = 1600;

export function IslandApp() {
  const { expanded, page, attachMode, dockEdge, settings, setPage, expand, collapse, toggle } =
    useIslandState();
  const data = useIslandData();
  const [toast, setToast] = useState<string | null>(null);

  const pillRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const insideRef = useRef<boolean | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(
      () => setToast((current) => (current === message ? null : current)),
      TOAST_DURATION
    );
  }, []);

  const summary = useMemo(() => {
    if (data.ai.running) {
      return { text: data.ai.title || "AI 正在处理…", muted: false, copyItemId: null };
    }
    const lastClipboard = data.clipboard[0];
    if (lastClipboard) {
      return {
        text: lastClipboard.type === "image" ? "复制了一张图片" : lastClipboard.content,
        muted: false,
        copyItemId: lastClipboard.id,
      };
    }
    const activeTodo = data.todos.find((todo) => !todo.completed && !todo.archived_at);
    if (activeTodo) {
      return { text: activeTodo.title, muted: false, copyItemId: null };
    }
    const lastNote = data.notes[0];
    if (lastNote) {
      return { text: lastNote.name, muted: false, copyItemId: null };
    }
    return { text: "QNote", muted: true, copyItemId: null };
  }, [data.ai, data.todos, data.clipboard, data.notes]);

  const hasContent = useMemo(
    () => ({
      todo: data.pendingTodoCount > 0,
      clipboard: data.clipboard.length > 0,
      notes: data.notes.length > 0,
      ai: data.ai.running,
    }),
    [data.pendingTodoCount, data.clipboard.length, data.notes.length, data.ai.running]
  );

  const counts = useMemo(
    () => ({
      todo: data.pendingTodoCount,
      clipboard: data.clipboard.length,
      notes: data.notes.length,
      ai: data.ai.running ? 1 : 0,
    }),
    [data.pendingTodoCount, data.clipboard.length, data.notes.length, data.ai.running]
  );

  const dragHandlers = useIslandDrag(() => {
    toggle();
  });
  const pressingRef = dragHandlers.pressingRef;

  const [copiedFlash, setCopiedFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const handleCopySummary = useCallback(async () => {
    const itemId = summary.copyItemId;
    if (itemId === null) return;
    let ok = false;
    try {
      const result = await window.electron.popupCopyClipboardItem(itemId);
      ok = Boolean(result?.success);
    } catch {
      ok = false;
    }
    if (!ok) return;
    setCopiedFlash("已复制");
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setCopiedFlash(null), 1200);
  }, [summary.copyItemId]);

  const handlePillPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      dragHandlers.onPointerDown(event);
    },
    [dragHandlers]
  );

  const handleHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("button")) return;
      if (!target.closest('[data-island-drag-handle="true"]')) return;
      dragHandlers.onPointerDown(event);
    },
    [dragHandlers]
  );

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (pressingRef.current) return;
      const card = expanded ? panelRef.current : pillRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (inside === insideRef.current) return;
      insideRef.current = inside;
      setPointerInside(inside);
      window.electron.islandSetInteractive(inside);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [expanded, pressingRef]);

  useEffect(() => {
    if (settings.expandTrigger !== "hover") return;

    if (pointerInside) {
      if (expanded) return;
      const timer = window.setTimeout(() => expand(), settings.hoverDelayMs);
      return () => window.clearTimeout(timer);
    }

    if (!expanded) return;
    const timer = window.setTimeout(() => collapse(), HOVER_LEAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [pointerInside, expanded, settings.expandTrigger, settings.hoverDelayMs, expand, collapse]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) {
        collapse();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, collapse]);

  const openMain = useCallback((targetPage: IslandPage, relPath?: string) => {
    void window.electron.islandOpenMain({ page: targetPage, relPath: relPath ?? null });
  }, []);

  const handleSelectPage = useCallback(
    (next: IslandPage) => {
      setPage(next);
      if (!expanded) expand();
    },
    [setPage, expanded, expand]
  );

  const panelBody = useMemo(() => {
    switch (page) {
      case "todo":
        return <TodoPanel todos={data.todos} onOpenMain={() => openMain("todo")} />;
      case "clipboard":
        return <ClipboardPanel items={data.clipboard} onCopied={showToast} />;
      case "notes":
        return (
          <NotesPanel notes={data.notes} onOpenNote={(relPath) => openMain("notes", relPath)} />
        );
      case "ai":
        return <AiChatPanel activity={data.ai} onOpenMain={() => openMain("ai")} />;
      default:
        return null;
    }
  }, [page, data.todos, data.clipboard, data.notes, data.ai, openMain, showToast]);

  return (
    <div
      className="island-root"
      data-attach={attachMode}
      data-edge={dockEdge}
      onPointerMove={dragHandlers.onPointerMove}
      onPointerUp={dragHandlers.onPointerUp}
      onPointerCancel={dragHandlers.endDrag}
      onLostPointerCapture={dragHandlers.endDrag}
    >
      <div onPointerDown={handlePillPointerDown}>
        <IslandCollapsedBar
          pillRef={pillRef}
          hidden={expanded}
          page={page}
          dockEdge={dockEdge}
          hasContent={hasContent}
          summary={copiedFlash ?? summary.text}
          summaryMuted={summary.muted}
          summaryCopyable={summary.copyItemId !== null}
          onCopySummary={() => void handleCopySummary()}
          onSelectPage={handleSelectPage}
          onToggle={toggle}
        />
      </div>

      <div onPointerDown={handleHeaderPointerDown}>
        <IslandPanel
          panelRef={panelRef}
          hidden={!expanded}
          page={page}
          dockEdge={dockEdge}
          counts={counts}
          onSelectPage={handleSelectPage}
          onCollapse={collapse}
        >
          {
}
          {panelBody}
        </IslandPanel>
      </div>

      {expanded && toast ? <div className="island-toast">{toast}</div> : null}
    </div>
  );
}
