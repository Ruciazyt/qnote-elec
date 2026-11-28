import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { StickyNoteInit } from "@shared/sticky/stickyNote";


const MIN_WIDTH = 120;
const MIN_HEIGHT = 70;

const MIN_CONTENT_WIDTH = 90;
const MAX_CONTENT_WIDTH = 460;

const PLACEHOLDER = "（空便签）";

function cssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function StickyNoteApp() {
  const [note, setNote] = useState<StickyNoteInit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const resizingRef = useRef(false);
  const noteRef = useRef<StickyNoteInit | null>(null);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const init = await window.electron.stickyGetInit();
        if (cancelled) return;
        if (!init) {
          setLoadError("这张便签已经不存在了");
          return;
        }
        setNote(init);
        setDraft(init.text);
      } catch {
        if (!cancelled) setLoadError("便签加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    const off = window.electron.onStickyEdit(() => {
      const current = noteRef.current;
      if (!current || current.type !== "text") return;
      if (resizingRef.current) return;
      setDraft(current.text);
      setEditing(true);
    });
    return () => off();
  }, []);

  useEffect(() => {
    const off = window.electron.onStickyAutoSize((enabled) => {
      setNote((prev) => (prev ? { ...prev, autoSize: enabled } : prev));
    });
    return () => off();
  }, []);

  useEffect(() => {
    const sync = () => {
      sizeRef.current = { width: window.innerWidth, height: window.innerHeight };
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const measureContent = useCallback((): { width: number; height: number } | null => {
    const el = measureRef.current;
    if (!el) return null;

    el.style.width = "max-content";
    el.style.whiteSpace = "pre";
    const natural = el.getBoundingClientRect().width;

    const contentWidth =
      Math.ceil(Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, natural))) + 2;

    el.style.whiteSpace = "pre-wrap";
    el.style.width = `${contentWidth}px`;
    const contentHeight = Math.ceil(el.getBoundingClientRect().height);

    return { width: contentWidth, height: contentHeight };
  }, []);

  const applyAutoSize = useCallback(() => {
    if (!note || note.type !== "text" || !note.autoSize) return;
    const measured = measureContent();
    if (!measured) return;

    const pad = cssPx("--sticky-pad", 20);
    const frame = cssPx("--sticky-frame", 16);
    const width = Math.round(measured.width + pad * 2 + frame * 2);
    const height = Math.round(measured.height + pad * 2 + frame * 2);

    const current = sizeRef.current;
    if (
      current.width &&
      Math.abs(current.width - width) < 2 &&
      Math.abs(current.height - height) < 2
    ) {
      return;
    }
    void window.electron.stickySetBounds({ id: note.id, width, height });
  }, [measureContent, note]);

  useEffect(() => {
    if (!note || note.type !== "text" || !note.autoSize) return;
    let cancelled = false;
    void (async () => {
      try {
        await document.fonts?.ready;
      } catch {
      }
      if (cancelled) return;
      applyAutoSize();
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAutoSize, note]);

  const saveText = useCallback(
    async (next: string) => {
      if (!note) return;
      if (next === note.text) {
        setEditing(false);
        return;
      }
      try {
        const result = await window.electron.stickyUpdate({ id: note.id, text: next });
        if (result?.ok) {
          setNote((prev) => (prev ? { ...prev, text: next } : prev));
        }
      } catch (err) {
        console.error("保存便签失败", err);
      } finally {
        setEditing(false);
      }
    },
    [note]
  );

  const handleClose = useCallback(() => {
    if (note) void window.electron.stickyClose(note.id);
  }, [note]);

  useEffect(() => {
    const onUp = () => {
      void window.electron.stickyMoveEnd();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const moveCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      moveCleanupRef.current?.();
    };
  }, []);

  const handleMoveGesture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!note || editing) return;
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let moving = false;

      const onMove = (moveEvent: PointerEvent) => {
        if (moving) return;
        if (Math.abs(moveEvent.clientX - startX) < 4 && Math.abs(moveEvent.clientY - startY) < 4) {
          return;
        }
        moving = true;
        void window.electron.stickyMoveBegin(note.id, { x: startX, y: startY });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        moveCleanupRef.current = null;
        if (moving) void window.electron.stickyMoveEnd();
      };
      moveCleanupRef.current = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    },
    [editing, note]
  );

    const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!note) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = sizeRef.current.width || note.width || 300;
      const startHeight = sizeRef.current.height || note.height || 200;

      target.setPointerCapture?.(event.pointerId);

      let switchedToManual = false;
      const onMove = (moveEvent: PointerEvent) => {
        resizingRef.current = true;
        const width = Math.max(MIN_WIDTH, Math.round(startWidth + (moveEvent.clientX - startX)));
        const height = Math.max(MIN_HEIGHT, Math.round(startHeight + (moveEvent.clientY - startY)));
        if (!switchedToManual) {
          switchedToManual = true;
          setNote((prev) => (prev ? { ...prev, autoSize: false } : prev));
        }
        void window.electron.stickySetBounds({
          id: note.id,
          width,
          height,
          autoSize: false,
        });
      };
      const onUp = () => {
        resizingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [note]
  );

  if (loadError) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-destructive p-3 text-center">
        {loadError}
      </div>
    );
  }

  if (!note) {
    return <div className="h-full w-full" />;
  }

  if (note.type === "image") {
    return (
      <div
        className="relative h-full w-full group"
        onPointerDown={handleMoveGesture}>
        <div
          className="h-full w-full"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onContextMenu={(e) => {
            e.preventDefault();
            void window.electron.stickyShowMenu();
          }}>
          {note.imageDataUrl ? (
            <img
              src={note.imageDataUrl}
              alt="便签图片"
              className="w-full h-full object-contain"
              draggable={false}
            />
          ) : (
            <p className="text-xs text-muted-foreground p-2">图片已失效</p>
          )}
        </div>

        <button
          onClick={handleClose}
          onPointerDown={(e) => e.stopPropagation()}
          title="关闭便签"
          aria-label="关闭便签"
          className="absolute top-1 right-1 w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground bg-background/85 opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:text-destructive transition-opacity duration-150"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="sticky-shell h-full w-full animate-sticky-appear">
      <div
        className="sticky-card group relative h-full w-full rounded-[14px] overflow-hidden flex flex-col"
        style={{
          WebkitAppRegion: "no-drag",
          cursor: editing ? "default" : "move",
        } as React.CSSProperties}
        onPointerDown={handleMoveGesture}
        onDoubleClick={() => {
          if (note.type === "text" && !editing) {
            setDraft(note.text);
            setEditing(true);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          void window.electron.stickyShowMenu();
        }}>
        {
}
        <div
          className="flex-1 min-h-0 overflow-auto"
          style={{
            WebkitAppRegion: "no-drag",
            padding: "var(--sticky-pad)",
          } as React.CSSProperties}>
          {editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              spellCheck={false}
              aria-label="编辑便签内容"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void saveText(draft);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                  setDraft(note.text);
                }
              }}
              onBlur={() => void saveText(draft)}
              className="sticky-text w-full h-full resize-none bg-transparent outline-none placeholder:text-[color:var(--sticky-hint)]"
              placeholder="写点什么…"
            />
          ) : (
            <pre className="sticky-text">
              {note.text || <span className="text-[color:var(--sticky-hint)]">（空便签）</span>}
            </pre>
          )}
        </div>

        {
}
        <div ref={measureRef} className="sticky-measure sticky-text" aria-hidden>
          {note.text || PLACEHOLDER}
        </div>

        {
}
        <div
          onPointerDown={handleResizeStart}
          title="拖动调整大小"
          aria-label="调整便签大小"
          role="separator"
          aria-orientation="horizontal"
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
            const step = e.shiftKey ? 64 : 16;
            const map: Record<string, [number, number]> = {
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
            };
            const delta = map[e.key];
            if (!delta || !note) return;
            e.preventDefault();
            const current = sizeRef.current;
            const baseWidth = current.width || note.width || 300;
            const baseHeight = current.height || note.height || 200;
            const nextWidth = Math.max(MIN_WIDTH, Math.round(baseWidth + delta[0]));
            const nextHeight = Math.max(MIN_HEIGHT, Math.round(baseHeight + delta[1]));
            setNote((prev) => (prev ? { ...prev, autoSize: false } : prev));
            void window.electron.stickySetBounds({
              id: note.id,
              width: nextWidth,
              height: nextHeight,
              autoSize: false,
            });
          }}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
          style={{
            WebkitAppRegion: "no-drag",
            background:
              "linear-gradient(135deg, transparent 50%, hsl(var(--sticky-ink) / 0.4) 50%, hsl(var(--sticky-ink) / 0.4) 60%, transparent 60%, transparent 70%, hsl(var(--sticky-ink) / 0.4) 70%, hsl(var(--sticky-ink) / 0.4) 80%, transparent 80%)",
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
