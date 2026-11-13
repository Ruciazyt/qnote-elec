import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, FolderOpen, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useRouteActive } from "@/hooks/useRouteActive";
import { useCollapsedState } from "@/hooks/useCollapsedState";
import { useNoteSidebarWidth } from "@/hooks/useNoteSidebarWidth";
import { useSplitRatio } from "@/hooks/useSplitRatio";
import { PanelResizer } from "@/components/panel/PanelResizer";
import { PanelHeightResizer } from "@/components/panel/PanelHeightResizer";
import { PANEL_RESIZER_WIDTH } from "@/components/browser/layout";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_HEADER_PADDING_X,
} from "@/components/panel/layout";
import {
  NOTE_SIDEBAR_COLLAPSED_WIDTH,
  NOTE_SIDEBAR_DEFAULT_WIDTH,
  NOTE_SIDEBAR_MAX_WIDTH,
  NOTE_SIDEBAR_MIN_WIDTH,
  NOTES_EDITOR_MIN_WIDTH,
  NOTES_EXTERNAL_COLLAPSED_HEIGHT,
  NOTES_EXTERNAL_COLLAPSE_MS,
  NOTES_EXTERNAL_EXPAND_MS,
  NOTES_SPLIT_DEFAULT_RATIO,
  NOTES_SPLIT_MAX_RATIO,
  NOTES_SPLIT_MIN_RATIO,
} from "@/components/Note/layout";
import NoteTypeTabs from "@/components/Note/NoteTypeTabs";
import NoteFileList from "@/components/Note/NoteFileList";
import { useIslandOpenNote } from "@/components/island/islandBridge";
import NoteExternalFolders from "@/components/Note/NoteExternalFolders";
import SaveNoteModal from "@/components/Note/SaveNoteModal";
import RenameConfirmModal from "@/components/Note/RenameConfirmModal";
import NamePromptModal from "@/components/Note/NamePromptModal";
import RichTextEditor from "@/components/Note/editors/RichTextEditor";
import ImageViewer from "@/components/Note/editors/ImageViewer";
import HtmlViewer from "@/components/Note/editors/HtmlViewer";
import PdfViewer from "@/components/Note/editors/PdfViewer";
import type { NoteEditorHandle } from "@/components/Note/editorHandle";
import {
  NOTE_TYPES,
  ExternalFolder,
  NoteTreeNode,
  NoteType,
  getNoteTypeMeta,
  withDefaultExt,
} from "../../shared/noteTypes";

type FileNode = Extract<NoteTreeNode, { kind: "file" }>;

/**
 * 侧栏内容区（路径行 + 文件树）的退场动效
 *
 * 与通用面板件 ResizableSidebar 同一套：150ms 淡出，
 * visibility 等淡完再切 —— 不带这层延迟的话元素立刻变 hidden，
 * 淡出走不到，肉眼看到的就是瞬切。
 *
 * 时长与延迟走 CSS 变量，规则写在 index.css 的 .notes-split-transition：
 * 那条规则同时管淡出、可见性切换与上下分栏的高度过渡，
 * 三个属性的时长各不相同，class 表达不了这种一对一的关系。
 */
const SIDEBAR_CONTENT_FADE_MS = 150;

/**
 * 白板编辑器按需加载
 *
 * Excalidraw 会把自身核心、mermaid / katex / ELK、几十个语言包和图表定义
 * 一起拖进来（首个 JS chunk 就有 1MB+），静态引入时全部计入首屏包，
 * 而笔记页并不是启动后立刻就用到的。
 * 拆成动态 import 后，白板代码（含它自己的 index.css）只在这块画布
 * 真正挂载时才拉取。
 *
 * 轻量编辑器（markdown / image）保持静态引入 —— 体积小，
 * 切过去要立刻出内容，加载态反而是倒退。
 */
const loadExcalidrawEditor = () => import("@/components/Note/editors/ExcalidrawEditor");
const ExcalidrawEditor = lazy(loadExcalidrawEditor);

/**
 * 白板分块的加载占位
 *
 * 只覆盖画布区域（外层是 absolute inset-0，撑满即可），
 * 侧边文件树和类型标签照常可用，不会整页被加载态盖住。
 * 样式沿用 App 顶层 Suspense 的加载态语言。
 */
function WhiteboardLoading() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center animate-fade-in">
      <div className="relative mb-4">
        <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl scale-125" />
        <div className="relative w-12 h-12 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground/70 font-medium">正在加载白板...</p>
    </div>
  );
}

/** 目标是否可编辑 —— 决定快捷键要不要让路 */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/** 在树里按 relPath 找文件节点 */
function findFile(nodes: NoteTreeNode[], relPath: string): FileNode | null {
  for (const n of nodes) {
    if (n.kind === "file") {
      if (n.relPath === relPath) return n;
    } else {
      const hit = findFile(n.children, relPath);
      if (hit) return hit;
    }
  }
  return null;
}

/** 在树里按 relPath 找任意节点（文件或文件夹）—— 重命名流程两者都要处理 */
function findNode(nodes: NoteTreeNode[], relPath: string): NoteTreeNode | null {
  for (const n of nodes) {
    if (n.relPath === relPath) return n;
    if (n.kind === "folder") {
      const hit = findNode(n.children, relPath);
      if (hit) return hit;
    }
  }
  return null;
}

/** 列出某个目录下所有条目的 relPath，用于判断另存为是否重名 */
function siblingRelPaths(nodes: NoteTreeNode[], folderRel: string): string[] {
  const segs = folderRel ? folderRel.split("/") : [];
  let level = nodes;
  for (const seg of segs) {
    const next = level.find((n) => n.kind === "folder" && n.name === seg);
    if (!next || next.kind !== "folder") return [];
    level = next.children;
  }
  return level.map((n) => n.relPath);
}

export default function NotesPage() {
  /** keep-alive 下页面切走后仍挂载，全局快捷键据此判断是否该响应 */
  const isActive = useRouteActive("/notes");
  const { toast } = useToast();

  const [filePath, setFilePath] = useState<string | null>(null);
  const [tree, setTree] = useState<NoteTreeNode[]>([]);
  const [activeType, setActiveType] = useState<NoteType>("excalidraw");
  /** 当前打开的文件；null 表示该类型的空白编辑态 */
  const [activeRelPath, setActiveRelPath] = useState<string | null>(null);
  /**
   * 各类型各自记住上次打开的文件，切标签回来能恢复
   *
   * 记的不只是路径，还要记它属于哪个根 —— 同一个 relPath 在笔记根目录
   * 和某个外部文件夹下可能指向两个不同的文件，只记路径会开错。
   *
   * 按 NOTE_TYPES 派生而非手写字面量：手写的话每加一种类型都会漏初始化，
   * 表现为「切到新类型的标签，打开态是 undefined 而不是空白态」。
   */
  const [lastRelByType, setLastRelByType] = useState<
    Record<NoteType, { relPath: string; externalId: string | null } | null>
  >(() =>
    NOTE_TYPES.reduce(
      (acc, { type }) => ({ ...acc, [type]: null }),
      {} as Record<NoteType, { relPath: string; externalId: string | null } | null>
    )
  );
  /** 已登记的外部文件夹（侧栏下半部分那一片） */
  const [externalFolders, setExternalFolders] = useState<ExternalFolder[]>([]);
  /** 外部文件夹的目录树（id → 树），展开时才读 */
  const [externalTrees, setExternalTrees] = useState<Record<string, NoteTreeNode[]>>({});
  /** 正在读树的外部文件夹 */
  const [loadingExternal, setLoadingExternal] = useState<Set<string>>(() => new Set());
  /**
   * 当前打开的文件属于哪个外部文件夹；null = 在笔记根目录里
   *
   * 这决定了编辑器按哪个根去定位文件 —— 根错了就会读到别的文件上。
   */
  const [activeExternalId, setActiveExternalId] = useState<string | null>(null);
  /** 新建笔记 / 粘贴图片的落盘目录；"" 表示根目录 */
  const [currentFolder, setCurrentFolder] = useState("");
  /** 已访问过的类型 —— 编辑器挂载后不卸载，避免 Excalidraw 画布被重置 */
  const [visitedTypes, setVisitedTypes] = useState<NoteType[]>(["excalidraw"]);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [customFileName, setCustomFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  /**
   * 待删除的条目 —— 连同它属于哪个根
   *
   * 「条目」和「属于哪个根」必须绑在一起：
   * 外部文件夹里的条目是磁盘上的真文件，确认框的措辞得跟着变
   * （主树的条目删了还能从回收站里捞回来，外部的删了就是删了），
   * 走的删除通道也不一样（外部走 id，主树走 filePath）。
   *
   * 早先拆成两个 state（条目 + 外部文件夹 id），关掉弹窗时只清了其中一个 ——
   * 残留的 id 会漏进下一次主树删除，「删主树的文件」就变成
   * 「删外部根里的同名文件」。合成一个对象，断不了。
   */
  const [pendingDelete, setPendingDelete] = useState<{
    /** 待删除的条目 */
    node: NoteTreeNode;
    /** null = 笔记根目录；否则是外部文件夹的 id */
    externalId: string | null;
  } | null>(null);
  const [renamingRel, setRenamingRel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [showRenameConfirm, setShowRenameConfirm] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  /** 正在新建的笔记类型；null 表示不在新建流程里 */
  const [creatingType, setCreatingType] = useState<NoteType | null>(null);
  /**
   * 本次新建的落点目录（相对路径，"" = 根目录）
   *
   * 与 currentFolder（「新建位置」）分开：工具栏的新建落在 currentFolder，
   * 右键某个文件夹新建则落在那个文件夹里 —— 两者不是一个位置，不能混用。
   */
  const [createTarget, setCreateTarget] = useState("");
  /**
   * 本次新建落在哪个外部文件夹；null = 落在笔记根目录
   *
   * 与 createTarget 分开记：createTarget 是相对路径，
   * 同一个相对路径在两个根下指的是两个地方，得说清落哪个根。
   */
  const [createExternalId, setCreateExternalId] = useState<string | null>(null);
  /** 新建笔记的文件名，用户可以在弹窗里改 */
  const [newFileName, setNewFileName] = useState("");
  /** 新建落盘进行中 */
  const [creatingFile, setCreatingFile] = useState(false);
  /** 正在拖拽移动的条目；非 null 时忽略后续移动请求 */
  const [movingRel, setMovingRel] = useState<string | null>(null);
  /**
   * 当前打开的笔记在磁盘上被改了，但本地还有未保存内容。
   * 非 null 时值为那条笔记的 relPath，等用户在弹窗里选怎么处理。
   */
  const [externalConflict, setExternalConflict] = useState<string | null>(null);

  const excalidrawRef = useRef<NoteEditorHandle>(null);
  const richTextRef = useRef<NoteEditorHandle>(null);
  const imageRef = useRef<NoteEditorHandle>(null);
  const htmlRef = useRef<NoteEditorHandle>(null);
  const pdfRef = useRef<NoteEditorHandle>(null);
  const excalidrawContainerRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  /** 根行容器 —— 侧栏宽度上限要从它的宽度反推 */
  const rootRef = useRef<HTMLDivElement>(null);
  /** 保存去重：Ctrl+S 可能被页面监听和 Excalidraw 菜单快捷键各触发一次 */
  const savingRef = useRef(false);
  /**
   * 当前打开条目的 mtime 快照 —— 外部变更检测靠它和刷新后的值比对。
   * 用 ref 而非 state：它只在事件回调里读，写入不该触发渲染。
   */
  const seenMtimeRef = useRef<number | null>(null);
  /**
   * 外部目录树的缓存
   *
   * loadExternalTree 要判断「这个文件夹读过了吗」，不能依赖闭包里那份旧 state
   * （那会让函数每次都重建，回调传给子组件也跟着换身份）。
   */
  const externalTreesRef = useRef<Record<string, NoteTreeNode[]>>({});
  externalTreesRef.current = externalTrees;

  const [sidebarCollapsed, setSidebarCollapsed] = useCollapsedState(
    "notes-sidebar-collapsed",
    true
  );

  /**
   * 正在收起（而不是展开）—— 决定过渡时长：退场比入场快
   *
   * 与通用面板件 ResizableSidebar 同一套：展开 220ms / 收起 150ms。
   * 收起是用户明确不要这块内容了，慢吞吞地缩回去是让人干等；
   * 展开是用户要看到东西，值得铺开。
   */
  const [sidebarCollapsing, setSidebarCollapsing] = useState(false);

  /** 收起/展开侧栏 —— 折叠按钮走这里，时长与状态一起切 */
  const toggleSidebarCollapsed = useCallback(() => {
    const next = !sidebarCollapsed;
    // next === true 表示正在收起 —— 退场用更短的时长
    setSidebarCollapsing(next);
    setSidebarCollapsed(next);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  /**
   * 侧栏内容区（路径行 + 文件树）是否还挂在 DOM 里
   *
   * 收起时不能直接卸载：卸载即消失，退场就成了「瞬切」，
   * 与通用面板件的 150ms 淡出对不上（P1-7）。
   * 改成收起那一刻先淡出（opacity 150ms、visibility 延迟 150ms 再切），
   * 淡完再卸载；展开时立即挂上，容器自己淡入。
   *
   * 淡出期间内容仍在 DOM 里，容器必须带 invisible ——
   * 只靠 opacity-0 + pointer-events-none 挡不住键盘，
   * 里面的按钮还会留在 Tab 序里（与 ResizableSidebar 的处理一致）。
   */
  const [sidebarContentMounted, setSidebarContentMounted] = useState(
    !sidebarCollapsed
  );

  useEffect(() => {
    if (!sidebarCollapsed) {
      setSidebarContentMounted(true);
      return;
    }
    // 已经卸载过就不必再等那 150ms
    if (!sidebarContentMounted) return;
    const timer = window.setTimeout(
      () => setSidebarContentMounted(false),
      SIDEBAR_CONTENT_FADE_MS
    );
    return () => window.clearTimeout(timer);
  }, [sidebarCollapsed, sidebarContentMounted]);

  /** 内容区这一帧用哪套过渡与可见性 */
  const sidebarContentStateClass = sidebarCollapsed
    ? "opacity-0 pointer-events-none invisible"
    : "opacity-100 visible";

  /* ── 外部文件夹区（侧栏下半部分） ──
     收起状态放在这一层：父容器要靠它给这块定高度 ——
     收起时只留标题行，空出来的高度全给主树。
     （以前这个状态在 NoteExternalFolders 内部，父容器不知道它，
       收起后 40% 的高度全是空白。） */
  const [externalCollapsed, setExternalCollapsed] = useCollapsedState(
    "notes-external-folders-collapsed",
    true
  );
  const toggleExternalCollapsed = useCallback(
    () => setExternalCollapsed((v) => !v),
    [setExternalCollapsed]
  );

  /* ── 主树与外部区的上下分栏（默认 6:4，可拖动） ── */
  const {
    ratio: externalRatio,
    setRatio: setExternalRatio,
    resetRatio: resetExternalRatio,
  } = useSplitRatio({
    storageKey: "notes-sidebar-split-ratio",
    defaultRatio: NOTES_SPLIT_DEFAULT_RATIO,
    minRatio: NOTES_SPLIT_MIN_RATIO,
    maxRatio: NOTES_SPLIT_MAX_RATIO,
  });

  /**
   * 拖拽上下分割线中：临时关掉高度过渡
   *
   * 两块的高度是 flex-basis，而它们身上挂着 150~220ms 的过渡
   * （.notes-split-transition）。过渡开着的话，拖拽的每一帧改高度都会把过渡
   * 重新计时 —— 面板永远慢半拍地追着指针跑，看起来就是「分割线卡顿、不跟手」。
   *
   * 宽度那条分割线早就有同样的处理（sidebarResizing → transitionProperty: none），
   * 上下这条漏了 —— 两边几何一样，处置却不一样。
   */
  const [splitResizing, setSplitResizing] = useState(false);

  /**
   * 两块各占多少高度
   *
   * 展开：按比例分（默认 6:4），各让出分割线的一半（3.5px）。
   * 收起：外部区只剩标题行，主树把剩下的全拿走。
   *
   * 用百分比而不是像素 —— 两块共享同一个容器，窗口一变高像素值就过时。
   * 百分比与像素都是长度，浏览器能在两种写法之间插值，收起/展开才是平滑的。
   */
  const mainTreeBasis = externalCollapsed
    ? `calc(100% - ${NOTES_EXTERNAL_COLLAPSED_HEIGHT + PANEL_RESIZER_WIDTH}px)`
    : `calc(${(1 - externalRatio) * 100}% - ${PANEL_RESIZER_WIDTH / 2}px)`;
  const externalBasis = externalCollapsed
    ? `${NOTES_EXTERNAL_COLLAPSED_HEIGHT}px`
    : `calc(${externalRatio * 100}% - ${PANEL_RESIZER_WIDTH / 2}px)`;

  /** 这一帧的高度过渡走哪档时长：退场比入场快（150 / 220） */
  const splitMoveMs = externalCollapsed
    ? NOTES_EXTERNAL_COLLAPSE_MS
    : NOTES_EXTERNAL_EXPAND_MS;

  /**
   * 过渡参数（走 CSS 变量，规则见 index.css 的 .notes-split-transition）
   *
   * 一条 transition 里同时管三件事：侧栏收起的淡出、可见性的切换时机、
   * 以及主树与外部区之间的高度过渡。属性不同、时长也不同，
   * 写在同一条里各走各的。
   */
  const splitTransitionVars = {
    "--notes-fade-ms": `${SIDEBAR_CONTENT_FADE_MS}ms`,
    "--notes-visibility-delay": sidebarCollapsed
      ? `${SIDEBAR_CONTENT_FADE_MS}ms`
      : "0s",
    "--notes-split-move-ms": `${splitMoveMs}ms`,
  } as React.CSSProperties;

  // ── 侧栏宽度（可拖拽） ──
  const { width: sidebarWidth, setWidth: setSidebarWidth } = useNoteSidebarWidth();
  /** 根行容器的实际宽度，写进 state 是为了让上限随窗口缩放重算 */
  const [rootWidth, setRootWidth] = useState(0);
  /** 拖拽中：临时关掉宽度的 CSS transition，否则侧栏会慢半拍地追着指针跑 */
  const [sidebarResizing, setSidebarResizing] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const sync = () => {
      const next = el.clientWidth;
      // 数字没变时 setState 是 no-op，不会白白触发一次渲染
      setRootWidth((prev) => (prev === next ? prev : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * 侧栏宽度上限 —— 窗口变窄时要跟着降，给编辑区留够 NOTES_EDITOR_MIN_WIDTH。
   *
   * 减去的两项：分割线自身占的 7px，以及编辑区的最小宽度。
   * 首次渲染 rootWidth 还是 0（ResizeObserver 还没回调），此时不设限，
   * 否则刚挂载就会拿 min 去钳出一个错误的上限。
   */
  const maxSidebarWidth = useMemo(() => {
    if (rootWidth <= 0) return NOTE_SIDEBAR_MAX_WIDTH;
    const available = rootWidth - PANEL_RESIZER_WIDTH - NOTES_EDITOR_MIN_WIDTH;
    return Math.max(
      NOTE_SIDEBAR_MIN_WIDTH,
      Math.min(NOTE_SIDEBAR_MAX_WIDTH, available)
    );
  }, [rootWidth]);

  /**
   * 实际渲染宽度再钳一次。
   * 窗口缩小后上限会跟着变小，但持久化的宽度还停在大值上；
   * 不在这里收一下，编辑区就会被挤到 NOTES_EDITOR_MIN_WIDTH 以下。
   */
  const effectiveSidebarWidth = Math.min(sidebarWidth, maxSidebarWidth);

  const handleResizeSidebar = useCallback(
    (next: number) => setSidebarWidth(next, maxSidebarWidth),
    [setSidebarWidth, maxSidebarWidth]
  );

  const handleResetSidebarWidth = useCallback(
    () => setSidebarWidth(NOTE_SIDEBAR_DEFAULT_WIDTH, maxSidebarWidth),
    [setSidebarWidth, maxSidebarWidth]
  );

  // ── 派生数据 ──

  /**
   * 当前打开的文件节点
   *
   * 外部文件夹里的文件不在主树里，得去它自己的树里找 ——
   * 两棵树可能有同名同路径的条目，找错树就会高亮到别的文件上。
   */
  const activeFile = useMemo<FileNode | null>(() => {
    if (!activeRelPath) return null;
    if (activeExternalId) {
      const extTree = externalTrees[activeExternalId];
      return extTree ? findFile(extTree, activeRelPath) : null;
    }
    return findFile(tree, activeRelPath);
  }, [tree, externalTrees, activeRelPath, activeExternalId]);

  /**
   * 当前打开的笔记所在的根目录
   *
   * 编辑器按 (根目录, relPath) 定位文件，根错了就会读到别的文件上。
   */
  const activeRootPath = useMemo(() => {
    if (activeExternalId) {
      return externalFolders.find((f) => f.id === activeExternalId)?.path ?? filePath;
    }
    return filePath;
  }, [activeExternalId, externalFolders, filePath]);

  /** 另存为的落点目录 —— 外部文件夹里没有"新建位置"，直接存它自己的根 */
  const saveFolder = activeExternalId ? "" : currentFolder;

  /** 待删除条目所属的外部文件夹名 —— 确认框里要点名它在哪个文件夹 */
  const pendingDeleteExternalName = useMemo(() => {
    const id = pendingDelete?.externalId;
    if (!id) return "";
    return externalFolders.find((f) => f.id === id)?.name ?? "";
  }, [pendingDelete, externalFolders]);

  /** 本次新建落在哪个外部文件夹 —— 命名弹窗里要点名落点 */
  const createExternalName = useMemo(() => {
    if (!createExternalId) return "";
    return externalFolders.find((f) => f.id === createExternalId)?.name ?? "";
  }, [createExternalId, externalFolders]);

  const counts = useMemo(() => {
    const acc = {} as Record<NoteType, number>;
    for (const { type } of NOTE_TYPES) acc[type] = 0;
    const walk = (list: NoteTreeNode[]) => {
      for (const n of list) {
        if (n.kind === "file") {
          if (n.type in acc) acc[n.type] += 1;
        } else walk(n.children);
      }
    };
    walk(tree);
    return acc;
  }, [tree]);

  /** 取当前类型编辑器的句柄 —— 所有保存入口都走它 */
  const activeEditor = useCallback((): NoteEditorHandle | null => {
    switch (activeType) {
      case "excalidraw":
        return excalidrawRef.current;
      case "markdown":
        return richTextRef.current;
      case "html":
        return htmlRef.current;
      case "pdf":
        return pdfRef.current;
      default:
        return imageRef.current;
    }
  }, [activeType]);

  /**
   * activeEditor 的 ref 镜像。
   * 外部变更回调里要用，但把它放进依赖数组会让订阅随标签切换反复重建，
   * 去掉又会拿到过期的 activeType —— 用 ref 中转，两头都不沾。
   */
  const activeEditorRef = useRef(activeEditor);
  activeEditorRef.current = activeEditor;

  /**
   * 打开 / 切换条目时同步 mtime 快照。
   * 漏掉这一步的话，切到一篇笔记后它的 mtime 仍是上一篇的值，
   * 下次外部变更通知会误判成「内容变了」。
   */
  useEffect(() => {
    seenMtimeRef.current = activeFile?.mtime ?? null;
  }, [activeRelPath, activeFile?.mtime]);

  const loadTree = useCallback(async () => {
    const p = await window.electron.getFilePath();
    setFilePath(p);
    setTree(p ? await window.electron.getNoteTree(p) : []);
  }, []);

  /** 读外部文件夹清单 */
  const loadExternalFolders = useCallback(async () => {
    try {
      const list = await window.electron.getExternalFolders();
      setExternalFolders(list ?? []);
    } catch (err) {
      console.error("加载外部文件夹清单失败", err);
    }
  }, []);

  /**
   * 读某个外部文件夹的目录树
   *
   * 展开时才读 —— 用户添加十个文件夹不代表要一次全扫一遍磁盘。
   */
  const loadExternalTree = useCallback(async (id: string, force = false) => {
    if (!force && externalTreesRef.current[id]) return;
    setLoadingExternal((prev) => new Set(prev).add(id));
    try {
      const nodes = await window.electron.getExternalTree(id);
      setExternalTrees((prev) => ({ ...prev, [id]: nodes }));
    } catch (err) {
      console.error("读取外部文件夹失败", err);
      setExternalTrees((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setLoadingExternal((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    void loadTree();
    void loadExternalFolders();
  }, [loadTree, loadExternalFolders]);

  /**
   * 笔记目录被外部改动时重新拉取目录树，并处理「正在打开的那一篇也被改了」。
   *
   * 触发方是 AI 写入笔记（save_note）或用户在外部编辑器里改文件。
   * 不订阅的话，AI 存好的笔记要等用户切走再切回来才看得见。
   *
   * 分流的关键：编辑器内部刻意用 loadedRelRef 做短路（同一路径只载入一次），
   * 否则每次刷目录树都会冲掉用户的光标和撤销历史。所以这里不能指望它自动更新，
   * 得比对 mtime，显式决定是重载还是提示冲突。
   *
   * 只在根目录一致时处理：AI 工具写的就是当前笔记根目录，
   * 不一致说明是别的目录，不该打扰当前视图。
   */
  useEffect(() => {
    if (!isActive || !filePath) return;
    return window.electron.onNotesChanged((root) => {
      if (root !== filePath) return;

      void (async () => {
        // 刷新前先记住当前打开文件的 mtime：刷完要用它判断内容是否真的变了
        const before = activeRelPath ? seenMtimeRef.current : null;
        await loadTree();

        if (!activeRelPath) return;
        const next = await window.electron.getNoteTree(filePath);
        const node = findFile(next, activeRelPath);
        if (!node) return; // 文件被删了，交给各处的删除逻辑处理

        // mtime 没变 → 这次变更与当前打开的条目无关（多半是新增了别的文件）
        seenMtimeRef.current = node.mtime;
        if (before === null || node.mtime === before) return;

        const editor = activeEditorRef.current();
        if (!editor) return;

        // 本地没有未保存改动 → 直接重载，用户看到的和磁盘保持一致
        if (!(editor.isDirty?.() ?? false)) {
          await editor.reload?.();
          return;
        }

        // 有未保存改动：不能替用户做决定，弹窗让他选
        setExternalConflict(activeRelPath);
      })();
    });
  }, [isActive, filePath, activeRelPath, loadTree, activeEditorRef]);

  /** 冲突弹窗：丢弃本地改动，改用磁盘上的版本 */
  const handleDiscardLocal = useCallback(async () => {
    setExternalConflict(null);
    const editor = activeEditorRef.current();
    await editor?.reload?.();
    toast({ title: "已载入磁盘上的最新版本", description: "本地未保存的改动已丢弃" });
  }, [toast]);

  /** 冲突弹窗：保留本地改动，忽略磁盘变更 */
  const handleKeepLocal = useCallback(() => {
    setExternalConflict(null);
    // 把 mtime 记成当前值，否则下一次外部变更通知会拿同一个旧值对比
    const node = activeRelPath ? findFile(tree, activeRelPath) : null;
    if (node) seenMtimeRef.current = node.mtime;
  }, [activeRelPath, tree]);

  /** 冲突弹窗：把本地改动存回去（覆盖磁盘版本） */
  const handleOverwriteDisk = useCallback(async () => {
    setExternalConflict(null);
    const editor = activeEditorRef.current();
    if (!editor?.currentRelPath()) return;
    const ok = await editor.save();
    if (ok) {
      const node = activeRelPath ? findFile(tree, activeRelPath) : null;
      if (node) seenMtimeRef.current = node.mtime;
      await loadTree();
      toast({ title: "已保存", description: "本地改动已覆盖磁盘版本" });
    }
  }, [activeRelPath, tree, loadTree, toast]);

  // ── 打开 / 切换 ──
  const handleOpen = useCallback((node: FileNode) => {
    setActiveType(node.type);
    setActiveRelPath(node.relPath);
    setActiveExternalId(null);
    setLastRelByType((prev) => ({
      ...prev,
      [node.type]: { relPath: node.relPath, externalId: null },
    }));
    setVisitedTypes((prev) => (prev.includes(node.type) ? prev : [...prev, node.type]));
  }, []);

  /**
   * 灵动岛里点了某篇笔记 → 这里把它打开
   *
   * 请求可能比目录树先到（岛上的列表是主进程自己扫盘得到的，
   * 主窗口这边还没拉树），所以先把 relPath 存着，
   * 等树里能找到了再打开。
   */
  const pendingIslandRelPath = useRef<string | null>(null);
  useIslandOpenNote((relPath) => {
    pendingIslandRelPath.current = relPath;
  });
  useEffect(() => {
    const relPath = pendingIslandRelPath.current;
    if (!relPath) return;
    const node = findFile(tree, relPath);
    if (!node) return; // 树还没拉回来，或这一篇已被删掉
    pendingIslandRelPath.current = null;
    handleOpen(node);
  }, [tree, handleOpen]);

  /**
   * 打开外部文件夹里的文件
   *
   * 与主树里的文件一样处理，只是根目录换成了那个外部文件夹 ——
   * 编辑器按 (根目录, relPath) 定位，relPath 仍是相对该文件夹的。
   */
  const handleOpenExternal = useCallback((folder: ExternalFolder, node: FileNode) => {
    setActiveType(node.type);
    setActiveRelPath(node.relPath);
    setActiveExternalId(folder.id);
    setLastRelByType((prev) => ({
      ...prev,
      [node.type]: { relPath: node.relPath, externalId: folder.id },
    }));
    setVisitedTypes((prev) => (prev.includes(node.type) ? prev : [...prev, node.type]));
  }, []);

  const handleTypeChange = useCallback(
    (type: NoteType) => {
      setActiveType(type);
      setVisitedTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));
      setRenamingRel(null);
      // 恢复该类型上次打开的文件；没有就开空白编辑态
      const last = lastRelByType[type];
      setActiveRelPath(last?.relPath ?? null);
      setActiveExternalId(last?.externalId ?? null);
    },
    [lastRelByType]
  );

  // ── 保存 ──
  const handleSaved = useCallback(
    (relPath: string) => {
      setActiveRelPath(relPath);
      setLastRelByType((prev) => ({
        ...prev,
        [activeType]: { relPath, externalId: activeExternalId },
      }));
      void loadTree();
      // 存的是外部文件夹里的文件 → 那棵树也要跟着更新
      if (activeExternalId) void loadExternalTree(activeExternalId, true);
    },
    [activeType, activeExternalId, loadTree, loadExternalTree]
  );

  const openSaveModal = useCallback(() => {
    setCustomFileName("");
    setShowSaveModal(true);
  }, []);

  const handleSaveAs = useCallback(() => {
    // 图片 / PDF 笔记只读，没有另存为
    if (activeType === "image" || activeType === "pdf") return;
    if (!activeEditor()) return;
    openSaveModal();
  }, [activeType, activeEditor, openSaveModal]);

  const handleSaveActive = useCallback(async () => {
    if (savingRef.current) return;
    if (activeType === "image" || activeType === "pdf") return;
    const editor = activeEditor();
    if (!editor) return;
    // 没有当前文件时退回「另存为」
    if (!editor.hasContent() || !editor.currentRelPath()) {
      openSaveModal();
      return;
    }
    savingRef.current = true;
    try {
      await editor.save();
    } finally {
      savingRef.current = false;
    }
  }, [activeType, activeEditor, openSaveModal]);

  const targetRelPath = useMemo(() => {
    const raw = customFileName.trim();
    if (!raw) return null;
    const name = withDefaultExt(raw, activeType);
    return saveFolder ? `${saveFolder}/${name}` : name;
  }, [customFileName, activeType, saveFolder]);

  // 重名检查要在同一个根里做 —— 外部文件夹和笔记根目录是两套文件空间
  const willOverwrite =
    !!targetRelPath &&
    siblingRelPaths(activeExternalId ? externalTrees[activeExternalId] ?? [] : tree, saveFolder).includes(
      targetRelPath
    );

  const handleSaveConfirm = useCallback(async () => {
    if (!targetRelPath) return;
    const editor = activeEditor();
    if (!editor) return;
    setSaving(true);
    try {
      const ok = await editor.save(targetRelPath);
      if (ok) {
        setShowSaveModal(false);
        const base = targetRelPath.slice(targetRelPath.lastIndexOf("/") + 1);
        toast({ title: "保存成功", description: base });
      }
    } finally {
      setSaving(false);
    }
  }, [targetRelPath, activeEditor, toast]);

  // ── 删除 ──
  const handleDeleteConfirm = useCallback(async () => {
    if (pendingDelete) {
      const { node, externalId } = pendingDelete;
      const isFolder = node.kind === "folder";
      const isFile = node.kind === "file";

      // 外部文件夹与笔记根目录是两套通道：前者直接动磁盘上的文件
      const ok = externalId
        ? isFolder
          ? await window.electron.deleteExternalFolder(externalId, node.relPath)
          : await window.electron.deleteExternalFile(externalId, node.relPath)
        : filePath
          ? isFolder
            ? await window.electron.deleteNoteFolder(filePath, node.relPath)
            : await window.electron.deleteNoteFile(filePath, node.relPath)
          : false;

      if (ok) {
        if (externalId) {
          // 外部文件夹：刷新那棵树；正在打开的条目若是它就清掉
          if (isFile && activeExternalId === externalId && activeRelPath === node.relPath) {
            setActiveRelPath(null);
          }
          await loadExternalTree(externalId, true);
        } else if (isFolder) {
          // 删掉文件夹后，若新建位置正指向它，回落到根目录
          setCurrentFolder((cur) =>
            cur === node.relPath || cur.startsWith(`${node.relPath}/`) ? "" : cur
          );
          setActiveRelPath((cur) =>
            cur && cur.startsWith(`${node.relPath}/`) ? null : cur
          );
        } else {
          // 删掉的正是当前打开的文件时，清掉各类型的打开状态
          setActiveRelPath((cur) => (cur === node.relPath ? null : cur));
          setLastRelByType((prev) => {
            const next = { ...prev };
            for (const { type } of NOTE_TYPES) {
              if (next[type]?.relPath === node.relPath) next[type] = null;
            }
            return next;
          });
        }
        if (!externalId) void loadTree();
      }
    }
    setShowDeleteModal(false);
    setPendingDelete(null);
  }, [
    pendingDelete,
    filePath,
    loadTree,
    loadExternalTree,
    activeExternalId,
    activeRelPath,
  ]);

  // ── 重命名 ──
  const handleRenameStart = useCallback((node: NoteTreeNode) => {
    setRenamingRel(node.relPath);
    // 文件夹不显示扩展名，文件要去掉扩展名
    setRenameValue(node.kind === "folder" ? node.name : node.name.replace(/\.[^.]+$/, ""));
  }, []);

  const handleRenameConfirm = useCallback(
    async (node: NoteTreeNode) => {
      const typed = renameValue.trim();
      setRenamingRel(null);
      if (!typed || typed === node.name) return;

      const ext = node.kind === "folder" ? "" : node.ext;
      const newName = typed + ext;
      if (newName === node.name) return;

      const parentRel = node.relPath.includes("/")
        ? node.relPath.slice(0, node.relPath.lastIndexOf("/"))
        : "";
      if (siblingRelPaths(tree, parentRel).includes(`${parentRel ? parentRel + "/" : ""}${newName}`)) {
        toast({ title: "同名条目已存在！", variant: "destructive" });
        return;
      }
      if (!filePath) return;

      setRenaming(true);
      const ok = await window.electron.renameNoteEntry(filePath, node.relPath, newName);
      setRenaming(false);
      if (!ok) return;

      // 路径尾部变了，同步所有引用
      const remap = (rel: string): string =>
        rel.startsWith(`${node.relPath}/`)
          ? `${parentRel ? parentRel + "/" : ""}${newName}/${rel.slice(node.relPath.length + 1)}`
          : rel;

      setCurrentFolder(remap(currentFolder));
      setActiveRelPath((cur) => (cur ? remap(cur) : null));
      setLastRelByType((prev) => {
        const next = { ...prev };
        for (const { type } of NOTE_TYPES) {
          const cur = next[type];
          // 只重写主树里的条目；外部文件夹的路径不受这次重命名影响
          if (cur && !cur.externalId) next[type] = { ...cur, relPath: remap(cur.relPath) };
        }
        return next;
      });
      void loadTree();
    },
    [renameValue, tree, filePath, currentFolder, activeRelPath, loadTree, toast]
  );

  const handleChangePath = useCallback(async () => {
    const newPath = await window.electron.selectDirs();
    if (newPath) {
      setCurrentFolder("");
      setActiveRelPath(null);
      // 按 NOTE_TYPES 重建，避免漏掉新增类型（曾经写死三种，切目录后新类型会留着旧路径）
      setLastRelByType(
        NOTE_TYPES.reduce(
          (acc, { type }) => ({ ...acc, [type]: null }),
          {} as Record<NoteType, { relPath: string; externalId: string | null } | null>
        )
      );
      void loadTree();
    }
  }, [loadTree]);

  /**
   * 「在文件管理器中打开」的目标
   *
   * 跟着当前上下文走，省得用户自己判断该开哪个目录：
   *   - 正打开着某条笔记 → 打开它所在目录并高亮该文件（reveal）
   *   - 选中了某个新建位置文件夹 → 打开那个文件夹（dir）
   *   - 其它情况 → 打开笔记根目录（dir）
   */
  const resolveExplorerTarget = useCallback((): { kind: "reveal"; relPath: string } | { kind: "dir"; relPath: string } => {
    if (activeRelPath) return { kind: "reveal", relPath: activeRelPath };
    if (currentFolder) return { kind: "dir", relPath: currentFolder };
    return { kind: "dir", relPath: "" };
  }, [activeRelPath, currentFolder]);

  const openTargetLabel = useMemo(() => {
    const target = resolveExplorerTarget();
    if (target.kind === "reveal") return "在文件夹中显示当前笔记";
    return target.relPath ? `打开文件夹 ${target.relPath}` : "打开笔记根目录";
  }, [resolveExplorerTarget]);

  const handleOpenInExplorer = useCallback(async () => {
    // 外部文件夹里的文件：路径由主进程从 id 解析，渲染层不碰目录
    if (activeExternalId) {
      const target = resolveExplorerTarget();
      try {
        const ok = await window.electron.revealExternalFile(
          activeExternalId,
          target.kind === "reveal" ? target.relPath : ""
        );
        if (!ok) {
          toast({ title: "无法定位", description: "文件可能已被移动或删除", variant: "destructive" });
        }
      } catch (error) {
        console.error("打开外部文件夹失败:", error);
        toast({
          title: "打开失败",
          description: error instanceof Error ? error.message : "未知错误",
          variant: "destructive",
        });
      }
      return;
    }
    if (!filePath) return;
    const target = resolveExplorerTarget();
    try {
      if (target.kind === "reveal") {
        // shell.showItemInFolder 会打开所在目录并高亮该文件
        const ok = await window.electron.revealInFolder(filePath, target.relPath);
        if (!ok) {
          toast({ title: "无法定位", description: "文件可能已被移动或删除", variant: "destructive" });
        }
        return;
      }
      // shell.openPath 成功时返回空串，非空即为错误信息
      const err = await window.electron.openInExplorer(filePath, target.relPath);
      if (err) {
        toast({ title: "打开失败", description: err, variant: "destructive" });
      }
    } catch (error) {
      console.error("打开文件夹失败:", error);
      toast({
        title: "打开失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      });
    }
  }, [filePath, activeExternalId, resolveExplorerTarget, toast]);

  // ── 外部文件夹 ──

  /** 弹目录选择框，把选中的文件夹登记进来 */
  const handleAddExternalFolder = useCallback(async () => {
    try {
      const list = await window.electron.addExternalFolders();
      // null = 用户取消了选择框
      if (!list) return;
      setExternalFolders(list ?? []);
      toast({
        title: list.length > 0 ? `已添加 ${list.length} 个文件夹` : "没有可添加的文件夹",
        description: list.length > 0 ? list.map((f) => f.name).join("、") : undefined,
      });
    } catch (error) {
      console.error("添加外部文件夹失败:", error);
      toast({ title: "添加失败", variant: "destructive" });
    }
  }, [toast]);

  /** 从清单里移除外部文件夹
   *
   * 只移出侧栏，不动磁盘上的文件 —— 所以不需要二次确认，
   * 但提示要说清楚，免得用户以为文件夹被删了。
   */
  const handleRemoveExternalFolder = useCallback(
    async (id: string) => {
      const folder = externalFolders.find((f) => f.id === id);
      try {
        const list = await window.electron.removeExternalFolder(id);
        setExternalFolders(list ?? []);
        // 正在打开的就是这个文件夹里的文件 → 回到空白态
        if (activeExternalId === id) {
          setActiveExternalId(null);
          setActiveRelPath(null);
        }
        toast({
          title: `已移除「${folder?.name ?? ""}」`,
          description: "磁盘上的文件没有改动",
        });
      } catch (error) {
        console.error("移除外部文件夹失败:", error);
        toast({ title: "移除失败", variant: "destructive" });
      }
    },
    [externalFolders, activeExternalId, toast]
  );

  // ── 外部文件夹的文件管理（增删改） ──

  /** 删除外部文件夹里的条目 —— 先弹确认框，磁盘上的真文件删了就没了 */
  const handleExternalDelete = useCallback(
    (folder: ExternalFolder, node: NoteTreeNode) => {
      setPendingDelete({ node, externalId: folder.id });
      setShowDeleteModal(true);
    },
    []
  );

  /** 重命名外部文件夹里的条目 */
  const handleExternalRename = useCallback(
    async (folder: ExternalFolder, node: NoteTreeNode, typed: string) => {
      const name = typed.trim();
      if (!name) return;

      const ext = node.kind === "folder" ? "" : node.ext;
      const newName = name + ext;
      if (newName === node.name) return;

      const ok = await window.electron.renameExternalEntry(folder.id, node.relPath, newName);
      if (!ok) {
        toast({
          title: "重命名失败",
          description: "同名条目已存在或名称不合法",
          variant: "destructive",
        });
        return;
      }

      // 路径尾部变了，同步当前打开的条目
      const remap = (rel: string): string =>
        rel.startsWith(`${node.relPath}/`)
          ? `${newName}/${rel.slice(node.relPath.length + 1)}`
          : rel;
      if (activeExternalId === folder.id && activeRelPath) {
        setActiveRelPath(remap(activeRelPath));
      }
      await loadExternalTree(folder.id, true);
    },
    [loadExternalTree, activeExternalId, activeRelPath, toast]
  );

  /** 在外部文件夹里新建文件夹 */
  const handleExternalCreateFolder = useCallback(
    (folder: ExternalFolder, target: string) => {
      setCreateTarget(target);
      setCreateExternalId(folder.id);
      setFolderName("");
      setShowFolderModal(true);
    },
    []
  );

  /** 在外部文件夹里新建笔记文件 */
  const handleExternalCreateFile = useCallback(
    (folder: ExternalFolder, type: NoteType, target: string) => {
      setCreateTarget(target);
      setCreateExternalId(folder.id);
      setCreatingType(type);
      setNewFileName("未命名");
    },
    []
  );

  /** 拖拽移动外部文件夹里的条目 */
  const handleExternalMove = useCallback(
    async (folder: ExternalFolder, fromRel: string, toFolderRel: string) => {
      const result = await window.electron.moveExternalEntry(folder.id, fromRel, toFolderRel);
      if (!result.ok) {
        toast({ title: "移动失败", description: result.reason, variant: "destructive" });
        return;
      }
      await loadExternalTree(folder.id, true);
      toast({ title: "已移动", description: toFolderRel || "根目录" });
    },
    [loadExternalTree, toast]
  );

  /** 从系统拖入文件到外部文件夹 */
  const handleExternalImportFiles = useCallback(
    async (folder: ExternalFolder, paths: string[]) => {
      const result = await window.electron.importExternalFiles(folder.id, paths, "");
      await loadExternalTree(folder.id, true);
      if (result.imported.length > 0) {
        toast({
          title: `已导入 ${result.imported.length} 个文件`,
          description: `到「${folder.name}」`,
        });
      } else {
        toast({
          title: "导入失败",
          description: "只支持笔记类型的文件",
          variant: "destructive",
        });
      }
    },
    [loadExternalTree, toast]
  );

  // ── 拖拽移动 ──
  /**
   * 把条目移动到另一个文件夹。
   *
   * 移动会改写 relPath，所以所有记着路径的状态都要跟着更新：
   * 当前打开的文件、各类型记忆、新建位置。重命名已经有一套 remap 逻辑，
   * 这里复用同一套思路 —— 换成相对于目标文件夹的新路径。
   */
  const handleMove = useCallback(

    async (fromRel: string, toFolderRel: string) => {
      if (!filePath || !fromRel) return;
      if (movingRel !== null) return;

      const name = fromRel.slice(fromRel.lastIndexOf("/") + 1);
      const nextRel = toFolderRel ? `${toFolderRel}/${name}` : name;
      if (nextRel === fromRel) return;

      setMovingRel(fromRel);
      try {
        const result = await window.electron.moveNoteEntry(filePath, fromRel, toFolderRel);
        if (!result.ok) {
          toast({ title: "移动失败", description: result.reason, variant: "destructive" });
          return;
        }

        setCurrentFolder((cur) => {
          // 移动的正是当前新建位置，或它的某个祖先 → 跟着挪
          if (cur === fromRel || cur.startsWith(`${fromRel}/`)) {
            return nextRel + cur.slice(fromRel.length);
          }
          return cur;
        });
        setActiveRelPath((cur) => (cur && cur.startsWith(`${fromRel}/`) ? nextRel + cur.slice(fromRel.length) : cur));
        setLastRelByType((prev) => {
          const next = { ...prev };
          for (const { type } of NOTE_TYPES) {
            const cur = next[type];
            // 只重写主树里的条目；外部文件夹的路径不受这次移动影响
            if (cur && !cur.externalId && cur.relPath.startsWith(`${fromRel}/`)) {
              next[type] = { ...cur, relPath: nextRel + cur.relPath.slice(fromRel.length) };
            }
          }
          return next;
        });
        void loadTree();
        toast({
          title: "已移动",
          description: nextRel,
        });
      } finally {
        setMovingRel(null);
      }
    },
    [filePath, movingRel, loadTree, toast]
  );

  /** 从系统拖入文件 → 复制进「新建位置」指向的目录 */
  const handleImportFiles = useCallback(
    async (paths: string[]) => {
      if (!filePath) {
        toast({ title: "导入失败", description: "请先设置笔记保存目录", variant: "destructive" });
        return;
      }
      try {
        const { imported, skipped } = await window.electron.importNoteFiles(
          filePath,
          paths,
          currentFolder
        );
        if (imported.length > 0) {
          await loadTree();
          toast({
            title: `已导入 ${imported.length} 个文件`,
            description: currentFolder ? `到「${currentFolder}」` : "到根目录",
          });
        }
        if (skipped.length > 0) {
          // 明确说跳过了什么，而不是静默丢弃 —— 用户会以为没生效
          toast({
            title: `${skipped.length} 个文件已跳过`,
            description: `仅支持笔记类型：${skipped.slice(0, 3).join("、")}${skipped.length > 3 ? " 等" : ""}`,
            variant: "destructive",
          });
        }
      } catch (err) {
        console.error("导入文件失败:", err);
        toast({ title: "导入失败", variant: "destructive" });
      }
    },
    [filePath, currentFolder, loadTree, toast]
  );

  // ── 新建文件夹 ──
  /**
   * 打开新建文件夹的命名框
   *
   * target 是落点目录：工具栏传「新建位置」，右键菜单传被右键的那个文件夹。
   */
  const handleCreateFolderStart = useCallback((target: string) => {
    setCreateTarget(target);
    setFolderName("");
    setShowFolderModal(true);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    const name = folderName.trim();
    if (!name) return;
    if (!createExternalId && !filePath) return;

    setCreatingFolder(true);
    const ok = createExternalId
      ? await window.electron.createExternalFolder(createExternalId, createTarget, name)
      : await window.electron.createNoteFolder(filePath!, createTarget, name);
    setCreatingFolder(false);
    if (!ok) {
      toast({ title: "新建失败", description: "同名文件夹已存在或名称不合法", variant: "destructive" });
      return;
    }
    setShowFolderModal(false);
    setFolderName("");
    setCreateExternalId(null);
    if (createExternalId) void loadExternalTree(createExternalId, true);
    else void loadTree();
  }, [filePath, createTarget, folderName, loadTree, createExternalId, loadExternalTree, toast]);

  // ── 新建笔记文件 ──
  /**
   * 侧栏「新建文件」菜单点进来：先记住类型与落点目录，再弹命名框。
   *
   * 命名放在弹窗里而不是直接落盘：默认名一旦落盘就留在目录里，
   * 用户还得再手动重命名一次，不如当场写好。
   */
  const handleCreateFileStart = useCallback(
    (type: NoteType, target: string) => {
      if (!filePath) return;
      setCreateTarget(target);
      setCreatingType(type);
      setNewFileName("未命名");
    },
    [filePath]
  );

  const handleCreateFileConfirm = useCallback(async () => {
    const type = creatingType;
    const name = newFileName.trim();
    if (!type || !name) return;
    if (!createExternalId && !filePath) return;

    setCreatingFile(true);
    try {
      const result = createExternalId
        ? await window.electron.createExternalFile(createExternalId, createTarget, name, type)
        : await window.electron.createNoteFile(filePath!, createTarget, name, type);
      if (!result.ok) {
        toast({ title: "新建失败", description: result.reason, variant: "destructive" });
        return;
      }

      setCreatingType(null);
      setNewFileName("");
      setCreateExternalId(null);

      if (createExternalId) {
        await loadExternalTree(createExternalId, true);
      } else {
        await loadTree();
      }

      // 打开新文件：切到对应类型、挂上编辑器、路径记进「该类型上次打开」
      setActiveType(type);
      setActiveRelPath(result.relPath);
      setActiveExternalId(createExternalId);
      setLastRelByType((prev) => ({
        ...prev,
        [type]: { relPath: result.relPath, externalId: createExternalId },
      }));
      setVisitedTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));

      toast({
        title: "已新建笔记",
        description: result.relPath.slice(result.relPath.lastIndexOf("/") + 1),
      });
    } finally {
      setCreatingFile(false);
    }
  }, [
    creatingType,
    newFileName,
    filePath,
    createTarget,
    createExternalId,
    loadTree,
    loadExternalTree,
    toast,
  ]);

  /* ── 传给子树的那批「引用必须稳定」的回调 ──
     目录树（NoteFileList）与外部文件夹区（NoteExternalFolders）都套了 memo：
     props 引用没变才跳过渲染。内联箭头函数每次渲染都是新引用，memo 直接失效 ——
     于是拖一次分割线，父组件每帧重渲染，两棵几百行的树就跟着每帧重建一遍。

     所以凡是传进这两棵树的回调，都必须在这里用 useCallback 固定住。
     新增 prop 时记得也在这里登记，别在 JSX 里写内联箭头。 */

  /** 主树：删除 —— 笔记根目录里的条目，externalId 显式给 null */
  const handleTreeDelete = useCallback((node: NoteTreeNode) => {
    // 不靠「上一个状态恰好是 null」来保证走主树通道
    setPendingDelete({ node, externalId: null });
    setShowDeleteModal(true);
  }, []);

  /** 主树：取消重命名 */
  const handleRenameCancel = useCallback(() => setRenamingRel(null), []);

  /** 主树：开始新建文件夹 */
  const handleTreeCreateFolder = useCallback(
    (target: string) => handleCreateFolderStart(target),
    [handleCreateFolderStart]
  );

  /** 主树：刷新目录树 */
  const handleTreeRefresh = useCallback(() => void loadTree(), [loadTree]);

  /** 外部文件夹区：展开 / 收起一个外部文件夹（展开时才去读它的树） */
  const handleToggleExternalFolder = useCallback(
    (id: string) => void loadExternalTree(id),
    [loadExternalTree]
  );

  /** 外部文件夹区：添加一个外部文件夹 */
  const handleAddExternal = useCallback(() => void handleAddExternalFolder(), [
    handleAddExternalFolder,
  ]);

  /** 外部文件夹区：从清单里移除一个外部文件夹 */
  const handleRemoveExternal = useCallback(
    (id: string) => void handleRemoveExternalFolder(id),
    [handleRemoveExternalFolder]
  );

  /** 外部文件夹区：刷新所有已展开的外部文件夹 */
  const handleRefreshExternal = useCallback(() => {
    for (const id of Object.keys(externalTrees)) void loadExternalTree(id, true);
  }, [externalTrees, loadExternalTree]);

  /** 外部文件夹区：重命名确认 */
  const handleExternalRenameConfirm = useCallback(
    (folder: ExternalFolder, node: NoteTreeNode, name: string) =>
      void handleExternalRename(folder, node, name),
    [handleExternalRename]
  );

  /** 外部文件夹区：拖拽移动条目 */
  const handleExternalMoveEntry = useCallback(
    (folder: ExternalFolder, from: string, to: string) =>
      void handleExternalMove(folder, from, to),
    [handleExternalMove]
  );

  /** 外部文件夹区：从系统拖入文件 */
  const handleExternalImport = useCallback(
    (folder: ExternalFolder, paths: string[]) =>
      void handleExternalImportFiles(folder, paths),
    [handleExternalImportFiles]
  );

  // ── 全局快捷键 ──
  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        if (e.key === "F2" && !isEditable(e.target) && activeRelPath) {
          const node = findFile(tree, activeRelPath);
          if (node) {
            e.preventDefault();
            handleRenameStart(node);
          }
        }
        return;
      }

      const key = e.key.toLowerCase();

      if (key === "s" && e.shiftKey) {
        e.preventDefault();
        handleSaveAs();
        return;
      }
      if (key === "s" && !e.shiftKey) {
        // 不像旧实现那样跳过输入框：编辑器里 Ctrl+S 本来就该存盘
        e.preventDefault();
        void handleSaveActive();
        return;
      }

      /**
       * Ctrl+V 存剪贴板图片 —— 图片笔记唯一的入口，界面上不设按钮。
       * 两处让路：输入框要正常粘贴文本；Excalidraw 画布自己会把图片贴进场景。
       */
      if (key === "v" && !e.shiftKey && !e.altKey && filePath) {
        if (isEditable(e.target)) return;
        if (excalidrawContainerRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        void (async () => {
          const entry = await window.electron.saveClipboardImageNote(filePath, currentFolder);
          if (!entry) return; // 剪贴板里没有图片，静默忽略
          await loadTree();
          setVisitedTypes((prev) => (prev.includes("image") ? prev : [...prev, "image"]));
          setActiveType("image");
          setActiveRelPath(entry.relPath);
          setLastRelByType((prev) => ({
            ...prev,
            image: { relPath: entry.relPath, externalId: null },
          }));
          toast({ title: "已保存图片", description: entry.name });
        })();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    isActive,
    filePath,
    tree,
    activeRelPath,
    currentFolder,
    loadTree,
    handleSaveAs,
    handleSaveActive,
    handleRenameStart,
  ]);

  /** 点空白处退出重命名 —— 名字没实质变化时直接静默取消 */
  useEffect(() => {
    if (!isActive) return;
    const onMouseDown = (e: MouseEvent) => {
      if (renamingRel === null) return;
      // 只有点在重命名输入框上才不算"点到别处"。
      // 这里原先判断的是 fileListRef.contains() —— 而列表里 rows 下方的空白、
      // 空状态区域全都属于该容器内部，于是"点空白"被当成点内部直接 return，
      // 编辑态永远退不出去。收窄成只看输入框即可。
      if ((e.target as HTMLElement | null)?.closest?.("[data-rename-input]")) return;
      const node = findNode(tree, renamingRel);
      const original = node
        ? node.kind === "folder"
          ? node.name
          : node.name.replace(/\.[^.]+$/, "")
        : "";
      const trimmed = renameValue.trim();
      if (!trimmed || trimmed === original) {
        setRenamingRel(null);
      } else {
        setShowRenameConfirm(true);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [isActive, renamingRel, renameValue, tree]);

  const typeLabel = getNoteTypeMeta(activeType).label;

  return (
    <TooltipProvider delayDuration={300}>
      {/* 根节点不铺底色：这一页整体就是 layout.tsx 的 .content-panel（--card），
          铺一层 --background 会在两栏之间留下色差，看起来像左栏还坐在外框里 */}
      <div ref={rootRef} className="flex h-full w-full relative">
        {/* ── 左：统一文件树 ──
            不再自带底色 —— 它是内容面板的左半部分，不是第二个侧栏。

            分栏线统一成 1px 语义边框（border-r border-border/60），
            不再投影：竖向分栏用 --border 这一个 token，明暗两套主题下
            看起来是同一种线。

            两态各用一种画法，但颜色与位置一致，切换时这条线不移动、不变淡：
            - 展开态：border-r border-border/60（1px 边框，占内容盒 1px）
            - 折叠态：inset -1px 0 0 0 hsl(var(--border) / 0.6)
              —— 用投影而不是边框，是因为折叠轨只有 48px，按钮要左右各留 8px；
              换成 1px 边框会让内容盒变成 47px，按钮右边只剩 7px，左右就不等宽了。

            transition 只过渡 width（原来是 transition-all）：
            过渡 all 会把 box-shadow 一起带上，收起那一帧阴影从「无」淡入、
            边框瞬间消失，这条线就会闪一下、强度也变了。

            motion-reduce:transition-none 是系统级「减少动态效果」的退路：
            开着的时候宽度直接跳到位，不做空间位移 —— 侧栏是折进去的，
            位置变化本身就是动效。对齐通用面板件 ResizableSidebar 与
            AppLogConsole 的做法（2026-11-05 走查补齐）。

            relative + z-10 保留：侧栏是 position:static，边框在绘制顺序第 3 步
            就画完了；右栏的编辑区是 absolute inset-0，属于第 6 步（定位后代），
            后画。现在的边框不再溢出到右栏，本来不会被盖，但保留 z-10 可以让
            「侧栏右缘永远压在画布之上」这件事不依赖任何隐含假设。

            展开/收起时长：展开 220ms / 收起 150ms（原来是一律 300ms）。
            与通用面板件 ResizableSidebar 同一套 —— 退场比入场快一档：
            收起是用户明确不要这块内容了，慢吞吞地缩回去是让人干等；
            展开是用户要看到东西，值得铺开。
            时长跟着「正在收起」这个状态走，所以切换按钮要过
            toggleSidebarCollapsed，不能直接 setSidebarCollapsed。

            overflow-hidden：收起那一帧内容区还在淡出（150ms），
            而路径行里的「切换」「在文件管理器中打开」两颗按钮
            最小宽度加起来就超过 48px 的轨道 —— 不裁的话它们会
            溢出到右栏的编辑器上（与头部行标题墨迹越界是同一类问题）。
            与通用面板件一致：aside 侧也是 overflow-hidden。

            这里刻意不加 items-center：收起时靠父容器居中，宽度过渡的那一帧
            轨道还是 288px 宽，按钮会先跳到 128px 处再滑回轨道正中，
            看起来就是横向跳一下。折叠轨的按钮改用固定左内边距锚定，
            见下面头部行那段注释。 */}
        <div
          data-notes-sidebar
          className={`relative z-10 h-full shrink-0 flex flex-col p-0 overflow-hidden transition-[width] motion-reduce:transition-none ${
            sidebarCollapsing ? "duration-150" : "duration-[220ms]"
          } ${sidebarCollapsed ? "" : "border-r border-border/60"}`}
          style={{
            // 收起时固定为折叠轨宽（NOTE_SIDEBAR_COLLAPSED_WIDTH = 48），
            // 展开时用拖出来的宽度
            width: sidebarCollapsed ? NOTE_SIDEBAR_COLLAPSED_WIDTH : effectiveSidebarWidth,
            // 折叠态的边界线：inset 阴影，不占内容盒（原因见上面的注释）。
            // 颜色与展开态的 border-border/60 是同一个 --border token。
            ...(sidebarCollapsed
              ? { boxShadow: "inset -1px 0 0 0 hsl(var(--border) / 0.6)" }
              : null),
            // 拖拽期间把 transition 关掉 —— 300ms 的宽度过渡会让侧栏慢半拍地
            // 追着指针跑。用行内样式而不是再加一个 transition-none 类：
            // 两个类都写 transition-property，谁赢取决于它们在样式表里的先后，
            // class 属性上的书写顺序管不了。
            ...(sidebarResizing ? { transitionProperty: "none" } : null),
          }}
        >
          {/* 折叠态这一行的横向几何 —— 与通用面板件（panel/layout.ts）同一套数。

              内边距走行内样式，不用 Tailwind 的 px-/pl- 类：
              类名里的数字是写死的，跟共享常量各走各的，改了常量类名不会跟着变。

              两态共用同一个左缘 8px（PANEL_COLLAPSED_BUTTON_INSET 与
              PANEL_HEADER_PADDING_X 取值相同，都是 8）：

              - 折叠态：8 + 32(按钮) + 8 = 48 = 折叠轨宽
                → 按钮正好落在轨道正中，左右各留 8px；
                focus 描边向外扩 1px 之后还剩 7px 余量，四边完整可见。
              - 展开态：头部左内边距同样是 8px
                → 切换时按钮的 x 一动不动，只有侧栏宽度在变，零横向位移。

              之前这里是「收起时 px-0 + 父容器 items-center 居中」：
              收起那一帧宽度还在从 288 往 48 过渡，轨道还是宽的，
              按钮先被摆到 128px 处，再一路滑回 4px —— 看着就是横跳一下；
              而且轨道只有 40px 时，8 + 32 + 8 已经放不下，左右留白只有 4px。

              上下留白用内边距（pt-2/pb-2）而不是外边距（mt-2/mb-2），行上再带 overflow-hidden：
              - overflow-hidden 的裁剪区是这一行自己的 padding box。外边距在盒外，
                只加 overflow-hidden 的话按钮上缘正好贴着行盒上缘，focus 描边向外扩的
                那 1px 落在裁剪区外，上下两条会被整条裁掉；换成内边距后按钮上缘比
                行盒上缘低 8px，描边四边完整。
              - 按钮的垂直位置两种写法一样（都落在容器顶 8..40）：
                外边距是整行下移 8，内边距是行内留 8。
              - overflow-hidden 治的是展开首帧：轨道从 48px 长到 288px 的那 300ms 里，
                标题刚挂上就被压成 min-content（一个汉字 14px 宽），两个汉字竖排，
                墨迹画到轨道右缘外 14px（轨道右缘 x=48、标题盒右缘 x=62），压在右栏工具条上。
                加了裁剪后墨迹被限制在轨道内
                （走查实测：轨道外 40×36 采样条里深色像素由 434 个降到 0 个）。 */}
          <div
            className="flex items-center pt-2 pb-2 flex-shrink-0 overflow-hidden"
            style={{
              paddingLeft: PANEL_COLLAPSED_BUTTON_INSET,
              paddingRight: sidebarCollapsed ? 0 : PANEL_HEADER_PADDING_X,
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={toggleSidebarCollapsed}
                  aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
                  aria-expanded={!sidebarCollapsed}
                  className="h-8 w-8 flex-shrink-0 rounded-lg transition-all duration-150 hover:bg-accent active:scale-90"
                >
                  {sidebarCollapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronLeft className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                <p className="text-xs">{sidebarCollapsed ? "展开侧栏" : "收起侧栏"}</p>
              </TooltipContent>
            </Tooltip>
            {!sidebarCollapsed && (
              /* 侧栏标题走 14px medium（text-sm font-medium）：
                 全应用只有页面主标题 h1 用 text-xl font-bold，
                 侧栏标题这一级用 text-sm，副信息/计数用 text-xs。
                 颜色交给 text-foreground —— 这一列现在是内容面板的一部分，
                 不该继续用为外框侧栏设计的 --sidebar-* token */
              <h3 className="text-sm font-medium ml-2 text-left flex-1 text-foreground">
                笔记
              </h3>
            )}
          </div>

          {/* 内容区（路径行 + 文件树）：收起时先淡出 150ms 再卸载 ——
              直接条件渲染是「瞬切」，与通用面板件的 150ms 淡出对不上。
              淡出期间内容还在 DOM 里，所以带上 invisible ——
              只靠 opacity-0 + pointer-events-none 挡不住键盘，
              里面的按钮还会留在 Tab 序里。 */}
          {sidebarContentMounted && (
            <>
              {/* 整个路径行都可点开目录选择器，未设置时用虚线提示可交互。
                  px-2(8px)：与头部切换按钮、文件树外框同一条左边线，
                  之前这里用 px-3(12px)，整列左边线是 8/12/8 三种 */}
              <div
                style={splitTransitionVars}
                className={`notes-split-transition flex items-center gap-2 px-2 mb-2 flex-shrink-0 ${sidebarContentStateClass}`}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleChangePath}
                      className={`flex-1 flex items-center gap-1.5 min-w-0 rounded-md px-1.5 py-1 transition-all duration-150 group
                        ${
                          !filePath
                            ? "border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 cursor-pointer"
                            : "hover:bg-accent cursor-pointer"
                        }`}
                      style={{ borderRadius: "calc(var(--radius) * 0.8)" }}
                    >
                      <FolderOpen
                        className={`h-3.5 w-3.5 flex-shrink-0 transition-colors duration-150 ${
                          !filePath ? "text-primary/60" : "text-muted-foreground"
                        } group-hover:text-primary`}
                      />
                      <span
                        className={`text-xs truncate ${
                          !filePath ? "text-primary/70 font-medium" : "text-muted-foreground font-medium"
                        }`}
                        title={filePath || undefined}
                      >
                        {filePath || "点击设置保存路径"}
                      </span>
                    </button>
                  </TooltipTrigger>
                  {filePath && (
                    <TooltipContent side="bottom" sideOffset={4}>
                      <p className="text-xs font-mono max-w-xs break-all">{filePath}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs flex-shrink-0 transition-all duration-150 hover:bg-accent hover:text-accent-foreground active:scale-95"
                  onClick={handleChangePath}
                >
                  切换
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!filePath}
                      aria-label="在文件管理器中打开"
                      className="h-6 w-6 flex-shrink-0 transition-all duration-150 hover:bg-accent hover:text-accent-foreground active:scale-90 disabled:opacity-40"
                      onClick={() => void handleOpenInExplorer()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    <p className="text-xs">{openTargetLabel}</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* ── 主树 + 外部文件夹：上下分栏 ──
                  默认 6:4（笔记树 6、外部文件夹 4），中间那条分割线可拖，
                  拖完的比例记在 localStorage。
                  两块的高度用百分比：它们共享这个容器，窗口一变高像素值就过时。 */}
              <div className="flex-1 min-h-0 flex flex-col">
                {/* 笔记树 */}
                <div
                  data-notes-split="tree"
                  data-split-ratio={externalRatio}
                  style={{
                    ...splitTransitionVars,
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: mainTreeBasis,
                    // 拖拽期间关掉过渡 —— 高度必须 1:1 跟手
                    ...(splitResizing ? { transitionProperty: "none" } : null),
                  }}
                  className={`notes-split-transition min-h-0 px-2 overflow-hidden flex flex-col ${sidebarContentStateClass}`}
                >
                  <NoteFileList
                    nodes={tree}
                    activeRelPath={activeRelPath}
                    currentFolder={currentFolder}
                    renamingRel={renamingRel}
                    renameValue={renameValue}
                    renaming={renaming}
                    onOpen={handleOpen}
                    onPickFolder={setCurrentFolder}
                    onDelete={handleTreeDelete}
                    onRenameStart={handleRenameStart}
                    onRenameChange={setRenameValue}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={handleRenameCancel}
                    onCreateFolder={handleTreeCreateFolder}
                    onCreateFile={handleCreateFileStart}
                    canCreateFile={!!filePath}
                    createTargetFolder={createTarget}
                    onMove={handleMove}
                    onRefresh={handleTreeRefresh}
                    onImportFiles={handleImportFiles}
                    fileListRef={fileListRef}
                  />
                </div>

                {/* 分割线（拖拽调高度）——
                    收起时禁用：下块只剩标题行，没有可调的高度。
                    它本身仍是 flex 兄弟节点真实占位，收起时那条分隔线也留着。 */}
                <PanelHeightResizer
                  ratio={externalRatio}
                  minRatio={NOTES_SPLIT_MIN_RATIO}
                  maxRatio={NOTES_SPLIT_MAX_RATIO}
                  onResize={setExternalRatio}
                  onReset={resetExternalRatio}
                  disabled={externalCollapsed}
                  // 拖拽期间关掉两块的高度过渡（见 splitResizing 的注释）
                  onDraggingChange={setSplitResizing}
                />

                {/* 外部文件夹（可收起）——
                    放在下半部分：主树在上面，外部文件夹是补充。
                    整块自带滚动，展开得再高也不会把主树挤没。
                    上边框由分割线那条 1px 线承担，两处都画就是两条线。 */}
                <div
                  data-notes-split="external"
                  data-split-ratio={externalRatio}
                  style={{
                    ...splitTransitionVars,
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: externalBasis,
                    // 拖拽期间关掉过渡 —— 高度必须 1:1 跟手
                    ...(splitResizing ? { transitionProperty: "none" } : null),
                  }}
                  className={`notes-split-transition min-h-0 px-2 py-1.5 overflow-hidden flex flex-col ${sidebarContentStateClass}`}
                >
                  <NoteExternalFolders
                    folders={externalFolders}
                    trees={externalTrees}
                    loadingIds={loadingExternal}
                    onToggleFolder={handleToggleExternalFolder}
                    onAdd={handleAddExternal}
                    onRemove={handleRemoveExternal}
                    onRefresh={handleRefreshExternal}
                    onOpenFile={handleOpenExternal}
                    onDelete={handleExternalDelete}
                    onRenameConfirm={handleExternalRenameConfirm}
                    onCreateFolder={handleExternalCreateFolder}
                    onCreateFile={handleExternalCreateFile}
                    onMove={handleExternalMoveEntry}
                    onImportFiles={handleExternalImport}
                    activeFolderId={activeExternalId}
                    activeRelPath={activeRelPath}
                    collapsed={externalCollapsed}
                    onToggleCollapsed={toggleExternalCollapsed}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── 分割线（拖拽调宽） ──
            收起时不渲染：侧栏已经退化成一条按钮轨，再留个 7px 热区既没意义
            也会挡住侧栏边缘的点击。
            side="left" —— 笔记侧栏在左、分割线贴着它的右缘，往右拖才是加宽。
            浏览器页侧栏在右（方向相反），那边用默认值。
            transparentAtRest 是必须的 —— 视觉分割由侧栏右缘那条 1px 边框承担，
            这 7px 只做拖拽热区，静止时不能是一条实底带子。 */}
        {!sidebarCollapsed && (
          <PanelResizer
            width={effectiveSidebarWidth}
            minWidth={NOTE_SIDEBAR_MIN_WIDTH}
            maxWidth={maxSidebarWidth}
            onResize={handleResizeSidebar}
            onReset={handleResetSidebarWidth}
            onDraggingChange={setSidebarResizing}
            side="left"
            transparentAtRest
          />
        )}

        {/* ── 右：类型切换栏 + 对应编辑器 ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            className="flex items-center gap-3 px-4 h-12 flex-shrink-0 border-b"
            style={{ borderColor: "hsl(var(--divider))" }}
          >
            <NoteTypeTabs active={activeType} onChange={handleTypeChange} counts={counts} />
            {/* min-w-0 必须有：flex 子项默认 min-width:auto，
                不写它 truncate 不生效 —— 笔记放在深层文件夹时，长路径会顶破这一行。
                标签栏则相反，固定不许被压缩。 */}
            <span
              className="text-xs text-muted-foreground truncate min-w-0 ml-auto"
              title={activeRelPath ?? undefined}
            >
              {activeFile
                ? activeExternalId
                  ? // 外部文件夹里的文件：带上文件夹名，否则同一个 relPath 看不出在哪
                    `${externalFolders.find((f) => f.id === activeExternalId)?.name ?? "外部文件夹"}/${activeFile.relPath}`
                  : activeFile.relPath
                : `${typeLabel} · 未打开文件`}
            </span>
          </div>

          <div className="flex-1 min-h-0 relative">
            {/* 编辑器挂载后不卸载（keep-alive），切走只是隐藏 ——
                否则每次切标签都会重置 Excalidraw 画布和未保存的内容。
                白板额外套一层 Suspense：分块没到时只遮住画布本身，
                Excalidraw 自己的 WelcomeScreen 仍然照常负责"空画布"提示，
                两者不会互相顶替 */}
            {visitedTypes.includes("excalidraw") && (
              <div
                className={`absolute inset-0 ${activeType === "excalidraw" ? "" : "hidden"}`}
                aria-hidden={activeType !== "excalidraw"}
              >
                <Suspense fallback={<WhiteboardLoading />}>
                  <ExcalidrawEditor
                    ref={excalidrawRef}
                    file={activeType === "excalidraw" ? activeFile : null}
                    dirPath={activeRootPath}
                    onRequestSaveAs={handleSaveAs}
                    onRequestSave={handleSaveActive}
                    onSaved={handleSaved}
                    containerRef={excalidrawContainerRef}
                  />
                </Suspense>
              </div>
            )}
            {visitedTypes.includes("markdown") && (
              <div
                className={`absolute inset-0 ${activeType === "markdown" ? "" : "hidden"}`}
                aria-hidden={activeType !== "markdown"}
              >
                <RichTextEditor
                  ref={richTextRef}
                  file={activeType === "markdown" ? activeFile : null}
                  dirPath={activeRootPath}
                  onSaved={handleSaved}
                  onRequestSaveAs={handleSaveAs}
                />
              </div>
            )}
            {visitedTypes.includes("html") && (
              <div
                className={`absolute inset-0 ${activeType === "html" ? "" : "hidden"}`}
                aria-hidden={activeType !== "html"}
              >
                <HtmlViewer
                  ref={htmlRef}
                  file={activeType === "html" ? activeFile : null}
                  dirPath={activeRootPath}
                  externalId={activeExternalId}
                />
              </div>
            )}
            {visitedTypes.includes("image") && (
              <div
                className={`absolute inset-0 ${activeType === "image" ? "" : "hidden"}`}
                aria-hidden={activeType !== "image"}
              >
                <ImageViewer
                  ref={imageRef}
                  file={activeType === "image" ? activeFile : null}
                  dirPath={activeRootPath}
                />
              </div>
            )}
            {visitedTypes.includes("pdf") && (
              <div
                className={`absolute inset-0 ${activeType === "pdf" ? "" : "hidden"}`}
                aria-hidden={activeType !== "pdf"}
              >
                <PdfViewer
                  ref={pdfRef}
                  file={activeType === "pdf" ? activeFile : null}
                  dirPath={activeRootPath}
                  externalId={activeExternalId}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── 弹窗 ── */}
        <SaveNoteModal
          show={showSaveModal}
          saving={saving}
          filePath={activeRootPath}
          folder={saveFolder}
          type={activeType}
          willOverwrite={willOverwrite}
          customFileName={customFileName}
          onChange={setCustomFileName}
          onCancel={() => setShowSaveModal(false)}
          onConfirm={handleSaveConfirm}
        />

        {/* 外部变更冲突：磁盘版本和本地未保存内容都在，不能替用户做决定 */}
        {externalConflict && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 modal-backdrop">
            <div className="bg-card rounded-lg shadow-lg p-6 w-96 border border-border modal-card">
              <h4 className="font-semibold text-lg mb-2 text-card-foreground">文件已在外部被修改</h4>
              <p className="text-sm text-muted-foreground mb-1">
                <span className="font-bold text-foreground break-all">{externalConflict}</span>{" "}
                在磁盘上有了新版本（可能是 AI 刚更新的），而这篇笔记还有你未保存的改动。
              </p>
              <p className="text-xs text-muted-foreground/70 mb-4">两边都保留，选择怎么处理：</p>
              <div className="flex flex-col gap-2">
                <Button variant="default" className="w-full" onClick={() => void handleOverwriteDisk()}>
                  保留我的改动（覆盖磁盘版本）
                </Button>
                <Button variant="outline" className="w-full" onClick={() => void handleDiscardLocal()}>
                  改用磁盘版本（丢弃本地未保存内容）
                </Button>
                <Button variant="ghost" className="w-full" onClick={handleKeepLocal}>
                  暂不处理，保持当前画面
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 删除确认框：用 ui/dialog（shadcn 那套），不用手写的 fixed inset-0 遮罩。
            手写遮罩没有 role="dialog"、没有焦点管理，Esc 也关不掉。

            文案按 docs/UI-GUIDELINES.md 第十节「破坏性确认框文案口径」：
            - 标题只写动作 + 对象类别，不带名字（标题是弹窗的可访问名称，要短）；
            - 正文句式固定「确定要删除{对象类别}「{name}」吗？」，三段齐全；
            - 名字用「」包住，font-medium text-foreground，长名 break-all；
            - 不可逆提示单独一行，text-destructive font-medium；
            - 正文必须由 DialogDescription 承载 ——
              ui/dialog 不会自动生成描述节点，只有真的渲染了它，
              Radix 才把它的 id 接上 aria-describedby；放在普通 <p> 里，
              弹窗打开那一瞬间读屏只念得到标题，「删的是哪一个」听不出来。
              正文里有 <br/> 和嵌套高亮 span，用 asChild 把内容包进去。 */}
        {showDeleteModal && pendingDelete && (
          <Dialog
            open={showDeleteModal}
            onOpenChange={(isOpen) => {
              // Esc 与点遮罩都走这里
              // 待删目标一起清掉 —— 留着没用了，还容易让人以为下次删的还是它
              if (!isOpen) {
                setShowDeleteModal(false);
                setPendingDelete(null);
              }
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-destructive" />
                  {pendingDelete.node.kind === "folder" ? "删除文件夹" : "删除笔记"}
                </DialogTitle>
                {pendingDelete.node.kind === "folder" ? (
                  <DialogDescription asChild>
                    <p className="text-sm text-muted-foreground">
                      确定要删除文件夹「
                      <span className="font-medium text-foreground break-all">
                        {pendingDelete.node.name}
                      </span>
                      」吗？
                      {pendingDeleteExternalName && (
                        <>
                          <br />
                          它位于外部文件夹「
                          <span className="font-medium text-foreground break-all">
                            {pendingDeleteExternalName}
                          </span>
                          」中。
                        </>
                      )}
                      <br />
                      <span className="text-destructive font-medium">
                        其中的 {pendingDelete.node.childCount} 个条目会一并永久删除，无法恢复。
                      </span>
                    </p>
                  </DialogDescription>
                ) : (
                  <DialogDescription asChild>
                    <p className="text-sm text-muted-foreground">
                      确定要删除笔记「
                      <span className="font-medium text-foreground break-all">
                        {pendingDelete.node.name}
                      </span>
                      」吗？
                      {pendingDeleteExternalName && (
                        <>
                          <br />
                          它位于外部文件夹「
                          <span className="font-medium text-foreground break-all">
                            {pendingDeleteExternalName}
                          </span>
                          」中。
                        </>
                      )}
                      <br />
                      <span className="text-destructive font-medium">
                        {pendingDeleteExternalName
                          ? "磁盘上的文件会被永久删除，无法恢复。"
                          : "此操作不可逆！"}
                      </span>
                    </p>
                  </DialogDescription>
                )}
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
                  取消
                </Button>
                <Button variant="destructive" onClick={handleDeleteConfirm}>
                  确定删除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <NamePromptModal
          show={showFolderModal}
          title="新建文件夹"
          placeholder="文件夹名称"
          hint={`位置：${createTarget || "根目录"}${
            createExternalName ? `（外部文件夹「${createExternalName}」）` : ""
          }`}
          value={folderName}
          busy={creatingFolder}
          onChange={setFolderName}
          onCancel={() => {
            setShowFolderModal(false);
            setCreateTarget("");
            setCreateExternalId(null);
          }}
          onConfirm={handleCreateFolder}
        />

        <NamePromptModal
          show={creatingType !== null}
          title={creatingType ? `新建${getNoteTypeMeta(creatingType).label}笔记` : "新建笔记"}
          placeholder="请输入文件名（无需后缀）"
          hint={`保存到：${
            createExternalName
              ? `外部文件夹「${createExternalName}」`
              : filePath || "未设置路径"
          }${createTarget ? " / " + createTarget : ""}${
            creatingType ? ` · 后缀 ${getNoteTypeMeta(creatingType).defaultExt}` : ""
          }`}
          value={newFileName}
          busy={creatingFile}
          onChange={setNewFileName}
          onCancel={() => {
            setCreatingType(null);
            setNewFileName("");
            setCreateTarget("");
            setCreateExternalId(null);
          }}
          onConfirm={handleCreateFileConfirm}
        />

        <RenameConfirmModal
          show={showRenameConfirm}
          onCancel={() => {
            setShowRenameConfirm(false);
            setRenamingRel(null);
          }}
          onConfirm={() => {
            if (renamingRel) {
              const node = findNode(tree, renamingRel);
              if (node) void handleRenameConfirm(node);
            }
            setShowRenameConfirm(false);
            setRenamingRel(null);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
