import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, Pin, PinOff, Pencil, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StickyNoteInit } from "@shared/stickyNote";

/**
 * 屏幕便签
 *
 * 这张页面跑在一个独立的透明 BrowserWindow 里 —— 窗口本身没有边框、
 * 永远压在桌面上方，用户看到的就是一张小纸条。
 *
 * ## 配色不单独定义
 *
 * 纸面、按钮、文字全部用 App 的设计变量（--card / --border / --primary /
 * --muted …），变量本身来自 App 的 index.css。便签因此和主窗口是同一套
 * 配色，App 改品牌色时便签跟着变，也不会出现"便签是琥珀色、App 是青色"
 * 的割裂感。所以这里**没有换色按钮**。
 *
 * 交互约定：
 *   - 顶部胶条 = 拖动区（`-webkit-app-region: drag`，由系统负责移动窗口）
 *   - 右上角小按钮：置顶层级 / 编辑（文本便签）/ 关闭
 *   - 正文双击进入编辑；Ctrl+Enter 保存，Esc 取消，失焦也保存
 *   - 右下角小三角 = 缩放手柄
 */

const MIN_WIDTH = 180;
const MIN_HEIGHT = 120;

export function StickyNoteApp() {
  const [note, setNote] = useState<StickyNoteInit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── 初始数据 ────────────────────────────────────────────── */
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
      } catch (err) {
        if (!cancelled) setLoadError("便签加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── 编辑态：进入时聚焦文本框 ─────────────────────────────── */
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing]);

  /* ── 保存正文 ────────────────────────────────────────────── */
  const saveText = useCallback(
    async (next: string) => {
      if (!note) return;
      if (next === note.text) {
        setEditing(false);
        return;
      }
      const result = await window.electron.stickyUpdate({ id: note.id, text: next });
      if (result?.ok) {
        setNote((prev) => (prev ? { ...prev, text: next } : prev));
      }
      setEditing(false);
    },
    [note]
  );

  /* ── 置顶层级切换 ────────────────────────────────────────── */
  const toggleAlwaysOnTop = useCallback(async () => {
    if (!note) return;
    const next = !note.alwaysOnTop;
    const result = await window.electron.stickyUpdate({ id: note.id, alwaysOnTop: next });
    if (result?.ok) {
      setNote((prev) => (prev ? { ...prev, alwaysOnTop: next } : prev));
    }
  }, [note]);

  /* ── 关闭 ────────────────────────────────────────────────── */
  const handleClose = useCallback(() => {
    if (note) void window.electron.stickyClose(note.id);
  }, [note]);

  /* ── 缩放：右下角手柄 ────────────────────────────────────── */
  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!note) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = note.width || 300;
      const startHeight = note.height || 200;

      target.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const width = Math.max(MIN_WIDTH, Math.round(startWidth + (moveEvent.clientX - startX)));
        const height = Math.max(MIN_HEIGHT, Math.round(startHeight + (moveEvent.clientY - startY)));
        void window.electron.stickySetBounds({ id: note.id, width, height });
      };
      const onUp = () => {
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
    // 数据还没到，先占位：透明窗口里什么都不画，避免闪一块白底
    return <div className="h-full w-full" />;
  }

  /* ── 图片便签：窗口就是图片本身 ──────────────────────────────
   *
   * 截图贴到桌面上，要的就是"截图本身"—— 不套卡片、不留边框和内衬，
   * 窗口尺寸等于图片尺寸（主进程算好了，见 imageDisplaySize）。
   *
   * 所以这里没有胶条、没有卡片容器。控制项也不常驻：
   *   - 关闭按钮：鼠标移上去才浮现，贴在角落内侧，不改变窗口尺寸
   *   - 置顶层级：走右键菜单（原生菜单，不占画面）
   *   - 拖动：整张图片就是拖动区
   * ---------------------------------------------------------------- */
  if (note.type === "image") {
    return (
      <div className="relative h-full w-full group">
        <div
          className="h-full w-full"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
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
          title="关闭便签"
          aria-label="关闭便签"
          className="absolute top-1 right-1 w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground bg-background/85 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity duration-150"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full p-1.5 animate-sticky-appear">
      <div
        className="sticky-card relative h-full w-full rounded-xl overflow-hidden flex flex-col"
        onDoubleClick={() => {
          if (note.type === "text" && !editing) {
            setDraft(note.text);
            setEditing(true);
          }
        }}>
        {/* 顶部胶条 —— 同时是窗口的拖动区 */}
        <div
          className="sticky-tape h-5 flex-shrink-0 flex items-center justify-between px-1.5"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
          <div
            className="flex items-center gap-0.5"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <button
              onClick={toggleAlwaysOnTop}
              title={note.alwaysOnTop ? "屏幕级置顶（点击改为普通置顶）" : "普通置顶（点击改为屏幕级置顶）"}
              aria-label="切换置顶层级"
              className={cn(
                "w-5 h-5 rounded-md flex items-center justify-center transition-colors duration-150",
                note.alwaysOnTop
                  ? "text-primary bg-primary/15"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}>
              {note.alwaysOnTop ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
            </button>

            {note.type === "text" && !editing && (
              <button
                onClick={() => {
                  setDraft(note.text);
                  setEditing(true);
                }}
                title="编辑内容"
                aria-label="编辑内容"
                className="w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150">
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={handleClose}
            title="关闭便签"
            aria-label="关闭便签"
            className="w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition-colors duration-150"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 正文（图片便签在上面已单独渲染，这里只剩文本） */}
        <div className="flex-1 min-h-0 overflow-auto px-2.5 pb-2 pt-1">
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
              className="w-full h-full resize-none bg-transparent outline-none font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-foreground placeholder:text-muted-foreground"
              placeholder="写点什么…"
            />
          ) : (
            <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-foreground">
              {note.text || "（空便签）"}
            </pre>
          )}
        </div>

        {/* 编辑提示：只在编辑态出现 */}
        {editing && (
          <div className="flex items-center justify-between px-2.5 pb-1.5 text-[10px] text-muted-foreground flex-shrink-0">
            <span>Ctrl+Enter 保存 · Esc 取消</span>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void saveText(draft)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors">
              <Check className="w-3 h-3" />
              保存
            </button>
          </div>
        )}

        {/* 右下角缩放手柄 */}
        <div
          onPointerDown={handleResizeStart}
          title="拖动调整大小"
          aria-label="调整便签大小"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, hsl(var(--muted-foreground) / 0.4) 50%, hsl(var(--muted-foreground) / 0.4) 60%, transparent 60%, transparent 70%, hsl(var(--muted-foreground) / 0.4) 70%, hsl(var(--muted-foreground) / 0.4) 80%, transparent 80%)",
          }}
        />
      </div>
    </div>
  );
}
