import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ISLAND_SHADOW_PAD_X, type IslandPage } from "@shared/island";
import { IslandCollapsedBar } from "./IslandCollapsedBar";
import { IslandPanel } from "./IslandPanel";
import { useIslandData } from "./useIslandData";
import { useIslandDrag, useIslandState } from "./useIslandState";
import { TodoPanel } from "./pages/TodoPanel";
import { ClipboardPanel } from "./pages/ClipboardPanel";
import { NotesPanel } from "./pages/NotesPanel";
import { AiChatPanel } from "./pages/AiChatPanel";

/** 悬停模式下，光标移开多久后收起 */
const HOVER_LEAVE_DELAY = 400;
/** 提示条停留时长 */
const TOAST_DURATION = 1600;

/**
 * 灵动岛
 *
 * 两层叠在一起：收起的胶囊和展开的面板。**两层始终都在 DOM 里**，
 * 只靠透明度互相让位 —— 收起时面板是透明的且不接收点击，
 * 但它的内部状态（滚动位置、正在输入的东西）不会因为一次展开就清零。
 *
 * 窗口尺寸由主进程逐帧驱动（见 core/window/island.ts），
 * 这里只管画内容、播淡入淡出、接交互。
 */
export function IslandApp() {
  const { expanded, page, attachMode, settings, setPage, expand, collapse, toggle } =
    useIslandState();
  const data = useIslandData();
  const [toast, setToast] = useState<string | null>(null);

  const pillRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 鼠标当前是不是落在卡片上 */
  const [pointerInside, setPointerInside] = useState(false);
  /**
   * 上一次命中判定的结果 —— 变了才发 IPC、才动状态
   *
   * 初值 null（还不知道）：第一次收到 mousemove 就要判一次，
   * 不然指针第一次落在岛外面时不会放行窗口，底下那圈透明区域会一直吃点击。
   */
  const insideRef = useRef<boolean | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(
      () => setToast((current) => (current === message ? null : current)),
      TOAST_DURATION
    );
  }, []);

  // ── 收起态宽度 ──────────────────────────────────────────────────────────
  //
  // 胶囊的宽度由摘要文字长度决定，量出来报给主进程，主进程据此摆窗口。
  // 用 ResizeObserver 而不是量一次 —— 摘要变了、字体加载完了，宽度都会变。
  useEffect(() => {
    const element = pillRef.current;
    if (!element) return;
    const report = () => {
      const width = Math.ceil(element.getBoundingClientRect().width);
      if (width > 0) window.electron.islandSetCollapsedWidth(width);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 阴影留白只有一个出处 —— shared/island.ts 的 ISLAND_SHADOW_PAD_X。
  // CSS 里再写死一份的话，两边迟早对不上（窗口比卡片宽多少、
  // 卡片往左偏多少），表现为阴影被裁出一道硬边。
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--island-shadow-pad-x",
      `${ISLAND_SHADOW_PAD_X}px`
    );
  }, []);

  // ── 摘要 ────────────────────────────────────────────────────────────────
  //
  // 优先级：正在跑的 AI > 进行中的待办 > 最近一条剪贴板 > 最近一篇笔记。
  // 先给最需要被看见的那件事。
  const summary = useMemo(() => {
    if (data.ai.running) {
      return { text: data.ai.title || "AI 正在处理…", muted: false };
    }
    const activeTodo = data.todos.find((todo) => !todo.completed && !todo.archived_at);
    if (activeTodo) {
      return { text: activeTodo.title, muted: false };
    }
    const lastClipboard = data.clipboard[0];
    if (lastClipboard) {
      return {
        text: lastClipboard.type === "image" ? "复制了一张图片" : lastClipboard.content,
        muted: false,
      };
    }
    const lastNote = data.notes[0];
    if (lastNote) {
      return { text: lastNote.name, muted: false };
    }
    return { text: "QNote", muted: true };
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

  // ── 拖动 ────────────────────────────────────────────────────────────────
  //
  // 收起态：整颗胶囊都能拖。
  // 展开态：只有页签行能拖 —— 面板里还有列表，在列表上按下拖动
  // 会把正在滚的内容变成「拖窗口」，体验很差。
  const dragHandlers = useIslandDrag(() => {
    toggle();
  });
  /** 指针是不是按着 —— 拖动期间不能改窗口的穿透状态 */
  const pressingRef = dragHandlers.pressingRef;

  const handlePillPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      dragHandlers.onPointerDown(event);
    },
    [dragHandlers]
  );

  const handleHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      // 按钮自己处理点击，别顺带发起拖动
      if (target.closest("button")) return;
      // **只有页签行是拖动手柄。**
      // 面板内容区（AI 输入框、列表项、空白处）按下是在干活，不是在拖窗口。
      // 早期版本把整个面板都当手柄 —— 在输入框里点一下、松手，
      // 就被「点击胶囊」那条路判成收起，面板当场消失，输了一半的字全丢。
      if (!target.closest('[data-island-drag-handle="true"]')) return;
      dragHandlers.onPointerDown(event);
    },
    [dragHandlers]
  );

  // ── 鼠标落在哪儿 ────────────────────────────────────────────────────────
  //
  // 两个用途：
  //
  //   1. 告诉主进程窗口要不要接收鼠标。窗口比卡片大一圈（给阴影留地方），
  //      那一圈是透明的，但窗口终归是矩形 —— 不放行的话，
  //      底下那三十来像素高的带子会把应用的点击吃掉。
  //   2. 悬停展开的判定。用「命中卡片」而不是「鼠标进了窗口」——
  //      进了窗口不等于碰到了岛。
  //
  // 自己做命中判定，不靠 mouseenter/mouseleave：
  // 窗口穿透时转发过来的只有 mousemove，DOM 的进入/离开不一定跟着来。
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      // 指针按着的时候不动穿透状态 ——
      // 窗口一放行鼠标，指针捕获就丢了，拖动会当场断掉。
      // 拖动时卡片比指针慢一帧，指针越过卡片边缘就会被判成「不在卡片上」，
      // 这时候放行穿透，拖动必断。
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

  // ── 悬停展开 ────────────────────────────────────────────────────────────
  //
  // 定时器跟着「指针在不在卡片上」走：进卡片等一会儿展开，
  // 离开卡片等一会儿收起 —— 等的是人把话说完、手从鼠标上抬起来。
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

  // Esc 收起
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) {
        collapse();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, collapse]);

  // ── 跳转主窗口 ──────────────────────────────────────────────────────────
  const openMain = useCallback((targetPage: IslandPage, relPath?: string) => {
    void window.electron.islandOpenMain({ page: targetPage, relPath: relPath ?? null });
  }, []);

  const handleSelectPage = useCallback(
    (next: IslandPage) => {
      setPage(next);
      // 点模块图标 = 切页并展开 —— 收起状态下点图标的人就是想看那一页
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
      onPointerMove={dragHandlers.onPointerMove}
      onPointerUp={dragHandlers.onPointerUp}
      // 指针被系统取消、或指针捕获被释放（鼠标在窗口外松开）时收尾，
      // 否则岛会一直粘在光标上
      onPointerCancel={dragHandlers.endDrag}
      onLostPointerCapture={dragHandlers.endDrag}
    >
      <div onPointerDown={handlePillPointerDown}>
        <IslandCollapsedBar
          pillRef={pillRef}
          hidden={expanded}
          page={page}
          hasContent={hasContent}
          summary={summary.text}
          summaryMuted={summary.muted}
          onSelectPage={handleSelectPage}
          onToggle={toggle}
        />
      </div>

      <div onPointerDown={handleHeaderPointerDown}>
        <IslandPanel
          panelRef={panelRef}
          hidden={!expanded}
          page={page}
          counts={counts}
          onSelectPage={handleSelectPage}
          onCollapse={collapse}
        >
          {/* 面板内容一直挂着，不跟着展开收起卸载 ——
              展开那一刻才 mount 一大棵列表，动画头几帧会掉帧，
              看着就是「抖了一下」。
              收起时面板是 visibility: hidden（结构性隐藏）：
              里面的按钮不会被 Tab 键选中，也不吃鼠标。 */}
          {panelBody}
        </IslandPanel>
      </div>

      {expanded && toast ? <div className="island-toast">{toast}</div> : null}
    </div>
  );
}
