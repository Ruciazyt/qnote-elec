import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { StickyNoteInit } from "@shared/stickyNote";

/**
 * 屏幕便签
 *
 * 这张页面跑在一个独立的透明 BrowserWindow 里 —— 窗口本身没有边框、
 * 永远压在桌面上方，用户看到的就是一张小纸条。
 *
 * ## 画面上只有一张纸
 *
 * 便签没有操作栏：顶部胶条、置顶按钮、编辑按钮、关闭按钮全部撤掉，
 * 画面上只剩纸和字。操作改走**右键菜单**（原生菜单，弹出即用、关掉就没），
 * 与图片便签的做法一致。
 *
 * ## 纸的大小跟着字走
 *
 * 便签**没有固定尺寸** —— 窗口大小由正文实际占位量出来，
 * 正好包住内容：一句短话是一张小纸片，一段长文换几行就长几行。
 *
 * 量尺寸靠一个屏幕外的隐藏元素，它和纸面上的正文共用同一个
 * `.sticky-text` 类（字体、行高、换行规则完全一致），
 * 量出来的数就是画出来的数。
 *
 * 用户拖过右下角的缩放手柄后，尺寸改成手动 —— 否则刚拖出来的尺寸
 * 会被下一次内容变化又缩回去。右键菜单里的「自适应大小」可以改回来。
 *
 * 交互约定：
 *   - 按住纸面拖动 = 移动便签（自己判别点击/拖动，不用 drag 拖动区 ——
 *     拖动区会把指针事件全吞掉，右键菜单与双击编辑就都没了）
 *   - 双击正文进入编辑；Ctrl+Enter 保存，Esc 取消，失焦也保存
 *   - 右键 = 菜单（编辑内容 / 屏幕级置顶 / 自适应大小 / 关闭便签）
 *   - 右下角小三角 = 缩放手柄（平时隐形，鼠标移上去才显形）
 *
 * ## 配色跟 App 走
 *
 * 纸面与字色接 App 的设计变量（见 sticky-index.css 的
 * `--sticky-paper` / `--sticky-ink`）—— 便签是 App 的一块纸，
 * 深浅主题都跟着 App 走；便签页与主窗口同源，主题设置是共享的。
 */

/** 手动缩放时的窗口尺寸下限 —— 再小就看不见纸了 */
const MIN_WIDTH = 120;
const MIN_HEIGHT = 70;

/**
 * 内容区（去掉内边距后的正文宽度）的上下限
 *
 * 上限：正文再长也在这个宽度里换行，便签不会横着铺满屏幕；
 * 下限：一句短话不该缩成一条细线。
 */
const MIN_CONTENT_WIDTH = 90;
const MAX_CONTENT_WIDTH = 460;

/** 空便签时纸面上显示的占位文字 —— 量尺寸时按它算 */
const PLACEHOLDER = "（空便签）";

/** 从 :root 上读一个像素值（与 CSS 里的变量保持同一份定义） */
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
  /** 量尺寸用的隐藏元素（纸面外，看不见但参与布局） */
  const measureRef = useRef<HTMLDivElement>(null);
  /**
   * 当前窗口尺寸
   *
   * 缩放手柄要以它为基准 —— note.width 是初始化时的快照，
   * 窗口被自动调整过之后它就不准了。
   */
  const sizeRef = useRef({ width: 0, height: 0 });
  /** 正在拖缩放手柄 —— 用来把"双击进编辑"和"拖手柄改尺寸"区分开 */
  const resizingRef = useRef(false);
  /** 最新正文 —— 给"从菜单进编辑"这类回调用，避免闭包里的旧值 */
  const noteRef = useRef<StickyNoteInit | null>(null);
  useEffect(() => {
    noteRef.current = note;
  }, [note]);

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

  /* ── 主进程让便签进入编辑态（右键菜单 → 编辑内容）──────────── */
  useEffect(() => {
    const off = window.electron.onStickyEdit(() => {
      // 用 ref 取最新的正文：菜单点开时可能已经改过内容，
      // 直接用闭包里的 note 会把草稿覆盖成旧文本
      const current = noteRef.current;
      // 图片便签没有正文可编辑，双击它不该有任何反应
      if (!current || current.type !== "text") return;
      // 正在拖缩放手柄时忽略 —— 那是改尺寸，不是改内容
      if (resizingRef.current) return;
      setDraft(current.text);
      setEditing(true);
    });
    return () => off();
  }, []);

  /* ── 主进程切换了尺寸模式（右键菜单 → 自适应大小）────────── */
  useEffect(() => {
    const off = window.electron.onStickyAutoSize((enabled) => {
      // 改 note 就会触发下面的"按内容调整尺寸"，纸自己缩回去
      setNote((prev) => (prev ? { ...prev, autoSize: enabled } : prev));
    });
    return () => off();
  }, []);

  /* ── 记录当前窗口尺寸 ──────────────────────────────────────
     窗口大小被改过（自动调整、用户拖手柄）后，缩放手柄的基准尺寸
     要跟着变 —— 否则拖动会从旧尺寸起算，一动就跳一大截。
     这里只记录、不做任何尺寸申请，所以不会和"按内容调整"互相触发。
     ---------------------------------------------------------------- */
  useEffect(() => {
    const sync = () => {
      sizeRef.current = { width: window.innerWidth, height: window.innerHeight };
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  /**
   * 量出正文占多大地方
   *
   * 两步：
   *   1. 不换行地量一次 → 得到这一行字本来有多长（自然宽度）
   *   2. 定下内容宽度（自然宽度与上下限之间取），再量一次高度 → 换行后的总高
   *
   * 量的是那个隐藏元素，它和纸面上的正文用同一个 `.sticky-text` 类，
   * 字体、行高、换行规则完全一致，所以量出来的数就是画出来的数。
   *
   * 宽度取 max-content 而不是 auto：绝对定位元素默认是"shrink-to-fit"，
   * 会被容器宽度截断 —— 便签窗口此刻才 300px 宽，长链接会被量成 300，
   * 纸就永远长不到该有的宽度。
   */
  const measureContent = useCallback((): { width: number; height: number } | null => {
    const el = measureRef.current;
    if (!el) return null;

    // ① 自然宽度：不让换行、不受容器宽度限制，量到的就是字本身有多长
    el.style.width = "max-content";
    el.style.whiteSpace = "pre";
    const natural = el.getBoundingClientRect().width;

    // ② 内容宽度：太长的折行，太短的给个下限。
    //    向上取整再加 2px 余量 —— 行高是 1.6 倍字号，算出来是 28.8 这种
    //    小数，不留余量的话渲染时可能差一点点就多折一行。
    const contentWidth =
      Math.ceil(Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, natural))) + 2;

    // ③ 在这个宽度下量高度（向上取整，保证纸装得下，不会冒出滚动条）
    el.style.whiteSpace = "pre-wrap";
    el.style.width = `${contentWidth}px`;
    const contentHeight = Math.ceil(el.getBoundingClientRect().height);

    return { width: contentWidth, height: contentHeight };
  }, []);

  /**
   * 把窗口调成正好包住正文
   *
   * 窗口尺寸 = 内容 + 上下左右内边距 + 外圈留白（留给投影）。
   *
   * 差不到 2px 就不动 —— 否则每次量完都触发一次窗口 resize，
   * resize 又引发重新渲染，来回抖。2px 的容差也顺带吃掉
   * innerWidth 与窗口实际尺寸之间那点零头。
   */
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

  /* ── 尺寸跟着正文走 ────────────────────────────────────────
     正文一变（保存后、重新打开时），就重新量一次。
     ---------------------------------------------------------------- */
  useEffect(() => {
    if (!note || note.type !== "text" || !note.autoSize) return;
    let cancelled = false;
    void (async () => {
      // 等字体就位再量：字体还没加载时量到的是回退字体的宽度
      try {
        await document.fonts?.ready;
      } catch {
        /* 字体 API 不可用就按当前字体量 */
      }
      if (cancelled) return;
      applyAutoSize();
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAutoSize, note]);

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

  /* ── 关闭 ────────────────────────────────────────────────── */
  const handleClose = useCallback(() => {
    if (note) void window.electron.stickyClose(note.id);
  }, [note]);

  /* ── 松手时结束主进程那边的会话 ─────────────────────────────
     长按生成便签之后，光标就落在**便签窗口**上了 —— 松手这个事件
     送到的是便签窗口，不是原来那条记录所在的窗口。
     所以便签这边也得收一次尾，否则主进程以为还在拖，
     便签会一直跟着光标跑。
     ---------------------------------------------------------------- */
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

  /**
   * 按住纸面拖动 → 移动便签
   *
   * 不用 `-webkit-app-region: drag` 来移动窗口：拖动区会把渲染层的指针
   * 事件**全部吞掉**（实测真实鼠标的按下、双击、右键一个都收不到），
   * 那样右键菜单和双击编辑就都没了。
   *
   * 所以改成自己判别"点击"还是"拖动"：按下后位移超过几像素才算拖动，
   * 没超过就当普通点击，交给浏览器（选中文字、双击进编辑）。
   * 真正的移动交给主进程用光标轮询来做 —— 渲染层的 clientX 是 CSS 像素，
   * 窗口坐标是 DIP，Windows 缩放不是 100% 时两者对不上。
   */
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
        // 把"按下鼠标时那一点在窗口内的位置"一起带上 —— 抓住哪儿便签就跟到哪儿，
        // 不会在起手时因为判定延迟而往回跳一下
        void window.electron.stickyMoveBegin(note.id, { x: startX, y: startY });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        if (moving) void window.electron.stickyMoveEnd();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    },
    [editing, note]
  );

  /* ── 缩放：右下角手柄 ────────────────────────────────────── */  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!note) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      // 基准取当前窗口尺寸（sizeRef），不取 note.width ——
      // 后者是初始化时的快照，窗口被自动调整过之后它就不准了
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
          // 用户开始手动调尺寸 → 尺寸模式切到"手动"。
          // 不切的话，内容一变纸又被缩回自适应的样子，这一拖就白拖了
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
          className="absolute top-1 right-1 w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground bg-background/85 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity duration-150"
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
          // 不用 drag 拖动区：它会把渲染层的指针事件全吞掉
          // （右键菜单、双击编辑都收不到），移动改走 handleMoveGesture
          WebkitAppRegion: "no-drag",
          // 拖动区的光标默认不变，给个 move 提示"这张纸可以拖"
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
          // 菜单里才有编辑 / 置顶 / 自适应 / 关闭，画面上不留任何常驻控件
          e.preventDefault();
          void window.electron.stickyShowMenu();
        }}>
        {/*
          正文（图片便签在上面已单独渲染，这里只剩文本）

          整张纸都是普通区域（no-drag）：双击能进编辑、右键能出菜单、
          字能选中、滚轮能滚。移动便签靠按住拖动（见 handleMoveGesture）。

          排版统一交给 `.sticky-text` —— 它同时被下面的量尺元素使用，
          字体、行高、换行规则一致，量出来的尺寸才是画出来的尺寸。
        */}
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

        {/*
          量尺寸用的隐藏元素

          它不显示，但参与布局 —— 脚本靠它量出正文占多大地方，
          再把窗口调成正好包住它。内容与纸面上的正文保持一致，
          空便签按占位文字算。
        */}
        <div ref={measureRef} className="sticky-measure sticky-text" aria-hidden>
          {note.text || PLACEHOLDER}
        </div>

        {/*
          右下角缩放手柄

          平时隐形，鼠标移上去才显形 —— 静止时画面上就只有一张纸和一段字。
          它必须是非拖动区：拖动区会吃掉指针事件，手柄就永远收不到。
        */}
        <div
          onPointerDown={handleResizeStart}
          title="拖动调整大小"
          aria-label="调整便签大小"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity duration-150"
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
