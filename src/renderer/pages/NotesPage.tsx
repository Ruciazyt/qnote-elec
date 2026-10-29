import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, FolderOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useRouteActive } from "@/hooks/useRouteActive";
import { useCollapsedState } from "@/hooks/useCollapsedState";
import { useNoteSidebarWidth } from "@/hooks/useNoteSidebarWidth";
import { PanelResizer } from "@/components/browser/PanelResizer";
import { PANEL_RESIZER_WIDTH } from "@/components/browser/layout";
import {
  NOTE_SIDEBAR_COLLAPSED_WIDTH,
  NOTE_SIDEBAR_DEFAULT_WIDTH,
  NOTE_SIDEBAR_MAX_WIDTH,
  NOTE_SIDEBAR_MIN_WIDTH,
  NOTES_EDITOR_MIN_WIDTH,
} from "@/components/Note/layout";
import NoteTypeTabs from "@/components/Note/NoteTypeTabs";
import NoteFileList from "@/components/Note/NoteFileList";
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
  NoteFileEntry,
  NoteTreeNode,
  NoteType,
  getNoteTypeMeta,
  withDefaultExt,
} from "../../shared/noteTypes";

type FileNode = Extract<NoteTreeNode, { kind: "file" }>;

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
        <div className="relative w-12 h-12 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center">
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
  /** 各类型各自记住上次打开的文件，切标签回来能恢复 */
  // 按 NOTE_TYPES 派生而非手写字面量：手写的话每加一种类型都会漏初始化，
  // 表现为「切到新类型的标签，打开态是 undefined 而不是空白态」。
  const [lastRelByType, setLastRelByType] = useState<Record<NoteType, string | null>>(() =>
    NOTE_TYPES.reduce((acc, { type }) => ({ ...acc, [type]: null }), {} as Record<NoteType, string | null>)
  );
  /** 新建笔记 / 粘贴图片的落盘目录；"" 表示根目录 */
  const [currentFolder, setCurrentFolder] = useState("");
  /** 已访问过的类型 —— 编辑器挂载后不卸载，避免 Excalidraw 画布被重置 */
  const [visitedTypes, setVisitedTypes] = useState<NoteType[]>(["excalidraw"]);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [customFileName, setCustomFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<NoteTreeNode | null>(null);
  const [renamingRel, setRenamingRel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [showRenameConfirm, setShowRenameConfirm] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  /** 正在新建的笔记类型；null 表示不在新建流程里 */
  const [creatingType, setCreatingType] = useState<NoteType | null>(null);
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

  const [sidebarCollapsed, setSidebarCollapsed] = useCollapsedState(
    "notes-sidebar-collapsed",
    true
  );

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
  const activeFile = useMemo<FileNode | null>(
    () => (activeRelPath ? findFile(tree, activeRelPath) : null),
    [tree, activeRelPath]
  );
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

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

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
    setLastRelByType((prev) => ({ ...prev, [node.type]: node.relPath }));
    setVisitedTypes((prev) => (prev.includes(node.type) ? prev : [...prev, node.type]));
  }, []);

  const handleTypeChange = useCallback(
    (type: NoteType) => {
      setActiveType(type);
      setVisitedTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));
      setRenamingRel(null);
      // 恢复该类型上次打开的文件；没有就开空白编辑态
      setActiveRelPath(lastRelByType[type]);
    },
    [lastRelByType]
  );

  // ── 保存 ──
  const handleSaved = useCallback(
    (relPath: string) => {
      setActiveRelPath(relPath);
      setLastRelByType((prev) => ({ ...prev, [activeType]: relPath }));
      void loadTree();
    },
    [activeType, loadTree]
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
    return currentFolder ? `${currentFolder}/${name}` : name;
  }, [customFileName, activeType, currentFolder]);

  const willOverwrite =
    !!targetRelPath && siblingRelPaths(tree, currentFolder).includes(targetRelPath);

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
    if (pendingDelete && filePath) {
      const ok =
        pendingDelete.kind === "folder"
          ? await window.electron.deleteNoteFolder(filePath, pendingDelete.relPath)
          : await window.electron.deleteNoteFile(filePath, pendingDelete.relPath);
      if (ok) {
        // 删掉的正是当前打开的文件时，清掉各类型的打开状态
        if (pendingDelete.kind === "file") {
          setActiveRelPath((cur) => (cur === pendingDelete.relPath ? null : cur));
          setLastRelByType((prev) => {
            const next = { ...prev };
            for (const { type } of NOTE_TYPES) {
              if (next[type] === pendingDelete.relPath) next[type] = null;
            }
            return next;
          });
        } else {
          // 删掉文件夹后，若新建位置正指向它，回落到根目录
          setCurrentFolder((cur) =>
            cur === pendingDelete.relPath || cur.startsWith(`${pendingDelete.relPath}/`) ? "" : cur
          );
          setActiveRelPath((cur) =>
            cur && cur.startsWith(`${pendingDelete.relPath}/`) ? null : cur
          );
        }
        void loadTree();
      }
    }
    setShowDeleteModal(false);
    setPendingDelete(null);
  }, [pendingDelete, filePath, loadTree]);

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
      if (siblingRelPaths(tree, parentRel).includes(`${parentRel ? `${parentRel}/` : ""}${newName}`)) {
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
          ? `${parentRel ? `${parentRel}/` : ""}${newName}/${rel.slice(node.relPath.length + 1)}`
          : rel;

      setCurrentFolder(remap(currentFolder));
      setActiveRelPath((cur) => (cur ? remap(cur) : null));
      setLastRelByType((prev) => {
        const next = { ...prev };
        for (const { type } of NOTE_TYPES) {
          const cur = next[type];
          if (cur) next[type] = remap(cur);
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
          {} as Record<NoteType, string | null>
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
  }, [filePath, resolveExplorerTarget, toast]);

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
            if (cur && cur.startsWith(`${fromRel}/`)) next[type] = nextRel + cur.slice(fromRel.length);
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
  const handleCreateFolder = useCallback(async () => {
    if (!filePath || !folderName.trim()) return;
    setCreatingFolder(true);
    const ok = await window.electron.createNoteFolder(filePath, currentFolder, folderName.trim());
    setCreatingFolder(false);
    if (!ok) {
      toast({ title: "新建失败", description: "同名文件夹已存在或名称不合法", variant: "destructive" });
      return;
    }
    setShowFolderModal(false);
    setFolderName("");
    void loadTree();
  }, [filePath, currentFolder, folderName, loadTree, toast]);

  // ── 新建笔记文件 ──
  /**
   * 侧栏「新建文件」菜单点进来：先记住类型，再弹命名框。
   *
   * 命名放在弹窗里而不是直接落盘：默认名一旦落盘就留在目录里，
   * 用户还得再手动重命名一次，不如当场写好。
   */
  const handleCreateFileStart = useCallback(
    (type: NoteType) => {
      if (!filePath) return;
      setCreatingType(type);
      setNewFileName("未命名");
    },
    [filePath]
  );

  const handleCreateFileConfirm = useCallback(async () => {
    const type = creatingType;
    const name = newFileName.trim();
    if (!type || !filePath || !name) return;

    setCreatingFile(true);
    try {
      const result = await window.electron.createNoteFile(filePath, currentFolder, name, type);
      if (!result.ok) {
        toast({ title: "新建失败", description: result.reason, variant: "destructive" });
        return;
      }

      setCreatingType(null);
      setNewFileName("");
      await loadTree();

      // 打开新文件：切到对应类型、挂上编辑器、路径记进「该类型上次打开」
      setActiveType(type);
      setActiveRelPath(result.relPath);
      setLastRelByType((prev) => ({ ...prev, [type]: result.relPath }));
      setVisitedTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));

      toast({
        title: "已新建笔记",
        description: result.relPath.slice(result.relPath.lastIndexOf("/") + 1),
      });
    } finally {
      setCreatingFile(false);
    }
  }, [creatingType, newFileName, filePath, currentFolder, loadTree, toast]);

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
          setLastRelByType((prev) => ({ ...prev, image: entry.relPath }));
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
            分栏靠 .neu-divider-r 的单侧投影（和工具栏下缘同一条规则），
            不画 1px 实线：两栏同在白底上，实线看着像外框残留的接缝。

            relative + z-10 是必须的，不能省
            侧栏是 position:static，它的 box-shadow 在绘制顺序第 3 步（常规块级背景）
            就画完了；而右栏的编辑区是 absolute inset-0，属于第 6 步（定位后代），
            后画、盖在上面。.neu-divider-r 的投影是向右溢出约 3px 的，那 3px
            落在右栏范围内 —— Excalidraw 的 canvas 不透明，于是把投影整条盖掉，
            表现为「只有绘图 tab 下分割线消失」，文本/图片因为背景透明反而正常。
            加上 z-10 让侧栏自成一个正 z-index 层叠上下文、排到第 7 步最后画，
            投影就始终压在画布之上。 */}
        <div
          className={`relative z-10 h-full shrink-0 flex flex-col p-0 transition-all duration-300 neu-divider-r ${
            sidebarCollapsed ? "items-center" : ""
          }`}
          style={{
            // 收起时固定 40px（原来的 w-10），展开时用拖出来的宽度
            width: sidebarCollapsed ? NOTE_SIDEBAR_COLLAPSED_WIDTH : effectiveSidebarWidth,
            // 拖拽期间把 transition 关掉 —— 300ms 的宽度过渡会让侧栏慢半拍地
            // 追着指针跑。用行内样式而不是再加一个 transition-none 类：
            // 两个类都写 transition-property，谁赢取决于它们在样式表里的先后，
            // class 属性上的书写顺序管不了。
            ...(sidebarResizing ? { transitionProperty: "none" } : null),
          }}
        >
          <div className="flex items-center mb-2 mt-2 px-3 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSidebarCollapsed((v) => !v)}
                  aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
                  className="h-8 w-8 rounded-lg transition-all duration-150 hover:bg-accent active:scale-90"
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
              /* 颜色交给 text-foreground：这一列现在是内容面板的一部分，
                 不该继续用为外框侧栏设计的 --sidebar-* token */
              <h3 className="font-bold text-lg ml-2 text-left flex-1 text-foreground">
                笔记
              </h3>
            )}
          </div>

          {!sidebarCollapsed && (
            <>
              {/* 整个路径行都可点开目录选择器，未设置时用虚线提示可交互 */}
              <div className="flex items-center gap-2 px-3 mb-2 flex-shrink-0">
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
                          !filePath ? "text-primary/60" : "text-muted-foreground/60"
                        } group-hover:text-primary`}
                      />
                      <span
                        className={`text-xs truncate ${
                          !filePath ? "text-primary/70 font-medium" : "text-muted-foreground/60"
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

              <div className="flex-1 min-h-0 px-2 overflow-hidden flex flex-col">
                <NoteFileList
                  nodes={tree}
                  activeRelPath={activeRelPath}
                  currentFolder={currentFolder}
                  renamingRel={renamingRel}
                  renameValue={renameValue}
                  renaming={renaming}
                  onOpen={handleOpen}
                  onPickFolder={setCurrentFolder}
                  onDelete={(node) => {
                    setPendingDelete(node);
                    setShowDeleteModal(true);
                  }}
                  onRenameStart={handleRenameStart}
                  onRenameChange={setRenameValue}
                  onRenameConfirm={handleRenameConfirm}
                  onRenameCancel={() => setRenamingRel(null)}
                  onCreateFolder={() => {
                    setFolderName("");
                    setShowFolderModal(true);
                  }}
                  onCreateFile={handleCreateFileStart}
                  canCreateFile={!!filePath}
                  onMove={handleMove}
                  onRefresh={() => void loadTree()}
                  onImportFiles={handleImportFiles}
                  fileListRef={fileListRef}
                />
              </div>
            </>
          )}
        </div>

        {/* ── 分割线（拖拽调宽） ──
            收起时不渲染：侧栏已经退化成一条按钮轨，再留个 7px 热区既没意义
            也会挡住侧栏边缘的点击。
            side="left" —— 笔记侧栏在左、分割线贴着它的右缘，往右拖才是加宽。
            浏览器页侧栏在右（方向相反），那边用默认值。
            transparentAtRest 是必须的 —— 视觉分割由侧栏的 .neu-divider-r 承担，
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
              className="text-xs text-muted-foreground/60 truncate min-w-0 ml-auto"
              title={activeRelPath ?? undefined}
            >
              {activeFile ? activeFile.relPath : `${typeLabel} · 未打开文件`}
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
                    dirPath={filePath}
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
                  dirPath={filePath}
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
                  dirPath={filePath}
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
                  dirPath={filePath}
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
                  dirPath={filePath}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── 弹窗 ── */}
        <SaveNoteModal
          show={showSaveModal}
          saving={saving}
          filePath={filePath}
          folder={currentFolder}
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

        {showDeleteModal && pendingDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 modal-backdrop">
            <div className="bg-card rounded-lg shadow-lg p-6 w-80 border border-border modal-card">
              <h4 className="font-semibold text-lg mb-2 text-card-foreground">删除确认</h4>
              {pendingDelete.kind === "folder" ? (
                <p className="text-sm text-muted-foreground mb-4">
                  确定要删除文件夹{" "}
                  <span className="font-bold text-foreground break-all">{pendingDelete.name}</span>{" "}
                  吗？
                  <br />
                  <span className="text-destructive">
                    其中的 {pendingDelete.childCount} 个条目会一并永久删除，无法恢复。
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mb-4">
                  确定要删除 <span className="font-bold break-all">{pendingDelete.name}</span> 吗？
                  <br />
                  文件将被永久删除，无法恢复。
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
                  取消
                </Button>
                <Button variant="destructive" onClick={handleDeleteConfirm}>
                  确定删除
                </Button>
              </div>
            </div>
          </div>
        )}

        <NamePromptModal
          show={showFolderModal}
          title="新建文件夹"
          placeholder="文件夹名称"
          hint={`位置：${currentFolder || "根目录"}`}
          value={folderName}
          busy={creatingFolder}
          onChange={setFolderName}
          onCancel={() => setShowFolderModal(false)}
          onConfirm={handleCreateFolder}
        />

        <NamePromptModal
          show={creatingType !== null}
          title={creatingType ? `新建${getNoteTypeMeta(creatingType).label}笔记` : "新建笔记"}
          placeholder="请输入文件名（无需后缀）"
          hint={`保存到：${filePath || "未设置路径"}${currentFolder ? ` / ${currentFolder}` : ""}${
            creatingType ? ` · 后缀 ${getNoteTypeMeta(creatingType).defaultExt}` : ""
          }`}
          value={newFileName}
          busy={creatingFile}
          onChange={setNewFileName}
          onCancel={() => {
            setCreatingType(null);
            setNewFileName("");
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
