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
import { useToast } from "@/hooks/ui/use-toast";
import { useRouteActive } from "@/hooks/system/useRouteActive";
import { useCollapsedState } from "@/hooks/panel/useCollapsedState";
import { useNoteSidebarWidth } from "@/hooks/panel/useNoteSidebarWidth";
import { useSplitRatio } from "@/hooks/panel/useSplitRatio";
import { PanelResizer } from "@/components/panel/PanelResizer";
import { PanelHeightResizer } from "@/components/panel/PanelHeightResizer";
import { PANEL_RESIZER_WIDTH } from "@/pages/browser/layout";
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
} from "@/pages/notes/layout";
import NoteTypeTabs from "@/pages/notes/NoteTypeTabs";
import NoteFileList from "@/pages/notes/NoteFileList";
import { useIslandOpenNote } from "@/pages/island/islandBridge";
import NoteExternalFolders from "@/pages/notes/NoteExternalFolders";
import SaveNoteModal from "@/pages/notes/SaveNoteModal";
import RenameConfirmModal from "@/pages/notes/RenameConfirmModal";
import NamePromptModal from "@/pages/notes/NamePromptModal";
import RichTextEditor from "@/pages/notes/editors/RichTextEditor";
import ImageViewer from "@/pages/notes/editors/ImageViewer";
import HtmlViewer from "@/pages/notes/editors/HtmlViewer";
import PdfViewer from "@/pages/notes/editors/PdfViewer";
import type { NoteEditorHandle } from "@/pages/notes/editorHandle";
import {
  NOTE_TYPES,
  ExternalFolder,
  NoteTreeNode,
  NoteType,
  getNoteTypeMeta,
  withDefaultExt,
} from "../../../shared/notes/noteTypes";

type FileNode = Extract<NoteTreeNode, { kind: "file" }>;

const SIDEBAR_CONTENT_FADE_MS = 150;

const loadExcalidrawEditor = () => import("@/pages/notes/editors/ExcalidrawEditor");
const ExcalidrawEditor = lazy(loadExcalidrawEditor);

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

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function findNodeIn(
  nodes: NoteTreeNode[],
  relPath: string,
  childrenMap: Record<string, NoteTreeNode[]>
): NoteTreeNode | null {
  for (const n of nodes) {
    if (n.relPath === relPath) return n;
    if (n.kind === "folder") {
      const kids = childrenMap[n.relPath] ?? n.children;
      if (kids && kids.length > 0) {
        const hit = findNodeIn(kids, relPath, childrenMap);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function findFileIn(
  nodes: NoteTreeNode[],
  relPath: string,
  childrenMap: Record<string, NoteTreeNode[]>
): FileNode | null {
  const node = findNodeIn(nodes, relPath, childrenMap);
  return node && node.kind === "file" ? node : null;
}

function layerOf(
  nodes: NoteTreeNode[],
  folderRel: string,
  childrenMap: Record<string, NoteTreeNode[]>
): NoteTreeNode[] {
  if (!folderRel) return nodes;
  let level = nodes;
  for (const seg of folderRel.split("/")) {
    const next = level.find((n) => n.kind === "folder" && n.name === seg);
    if (!next || next.kind !== "folder") return [];
    level = childrenMap[next.relPath] ?? next.children ?? [];
  }
  return level;
}

function siblingRelPaths(
  nodes: NoteTreeNode[],
  folderRel: string,
  childrenMap: Record<string, NoteTreeNode[]>
): string[] {
  return layerOf(nodes, folderRel, childrenMap).map((n) => n.relPath);
}

export default function NotesPage() {
  const isActive = useRouteActive("/notes");
  const { toast } = useToast();

  const [filePath, setFilePath] = useState<string | null>(null);
  const [tree, setTree] = useState<NoteTreeNode[]>([]);
  const [treeChildren, setTreeChildren] = useState<Record<string, NoteTreeNode[]>>({});
  const [activeType, setActiveType] = useState<NoteType>("excalidraw");
  const [activeRelPath, setActiveRelPath] = useState<string | null>(null);
  const [lastRelByType, setLastRelByType] = useState<
    Record<NoteType, { relPath: string; externalId: string | null } | null>
  >(() =>
    NOTE_TYPES.reduce(
      (acc, { type }) => ({ ...acc, [type]: null }),
      {} as Record<NoteType, { relPath: string; externalId: string | null } | null>
    )
  );
  const [externalFolders, setExternalFolders] = useState<ExternalFolder[]>([]);
  const [externalTrees, setExternalTrees] = useState<Record<string, NoteTreeNode[]>>({});
  const [externalTreeChildren, setExternalTreeChildren] = useState<
    Record<string, Record<string, NoteTreeNode[]>>
  >({});
  const [loadingExternal, setLoadingExternal] = useState<Set<string>>(() => new Set());
  const [activeExternalId, setActiveExternalId] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState("");
  const [visitedTypes, setVisitedTypes] = useState<NoteType[]>(["excalidraw"]);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [customFileName, setCustomFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    node: NoteTreeNode;
    externalId: string | null;
  } | null>(null);
  const [renamingRel, setRenamingRel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [showRenameConfirm, setShowRenameConfirm] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingType, setCreatingType] = useState<NoteType | null>(null);
  const [createTarget, setCreateTarget] = useState("");
  const [createExternalId, setCreateExternalId] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [movingRel, setMovingRel] = useState<string | null>(null);
  const [externalConflict, setExternalConflict] = useState<string | null>(null);

  const excalidrawRef = useRef<NoteEditorHandle>(null);
  const richTextRef = useRef<NoteEditorHandle>(null);
  const imageRef = useRef<NoteEditorHandle>(null);
  const htmlRef = useRef<NoteEditorHandle>(null);
  const pdfRef = useRef<NoteEditorHandle>(null);
  const excalidrawContainerRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const seenMtimeRef = useRef<number | null>(null);
  const externalTreesRef = useRef<Record<string, NoteTreeNode[]>>({});
  externalTreesRef.current = externalTrees;

  const [sidebarCollapsed, setSidebarCollapsed] = useCollapsedState(
    "notes-sidebar-collapsed",
    true
  );

  const [sidebarCollapsing, setSidebarCollapsing] = useState(false);

  const toggleSidebarCollapsed = useCallback(() => {
    const next = !sidebarCollapsed;
    setSidebarCollapsing(next);
    setSidebarCollapsed(next);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  const [sidebarContentMounted, setSidebarContentMounted] = useState(
    !sidebarCollapsed
  );

  useEffect(() => {
    if (!sidebarCollapsed) {
      setSidebarContentMounted(true);
      return;
    }
    if (!sidebarContentMounted) return;
    const timer = window.setTimeout(
      () => setSidebarContentMounted(false),
      SIDEBAR_CONTENT_FADE_MS
    );
    return () => window.clearTimeout(timer);
  }, [sidebarCollapsed, sidebarContentMounted]);

  const sidebarContentStateClass = sidebarCollapsed
    ? "opacity-0 pointer-events-none invisible"
    : "opacity-100 visible";

  const [externalCollapsed, setExternalCollapsed] = useCollapsedState(
    "notes-external-folders-collapsed",
    true
  );
  const toggleExternalCollapsed = useCallback(
    () => setExternalCollapsed((v) => !v),
    [setExternalCollapsed]
  );

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

  const [splitResizing, setSplitResizing] = useState(false);

  const mainTreeBasis = externalCollapsed
    ? `calc(100% - ${NOTES_EXTERNAL_COLLAPSED_HEIGHT + PANEL_RESIZER_WIDTH}px)`
    : `calc(${(1 - externalRatio) * 100}% - ${PANEL_RESIZER_WIDTH / 2}px)`;
  const externalBasis = externalCollapsed
    ? `${NOTES_EXTERNAL_COLLAPSED_HEIGHT}px`
    : `calc(${externalRatio * 100}% - ${PANEL_RESIZER_WIDTH / 2}px)`;

  const splitMoveMs = externalCollapsed
    ? NOTES_EXTERNAL_COLLAPSE_MS
    : NOTES_EXTERNAL_EXPAND_MS;

  const splitTransitionVars = {
    "--notes-fade-ms": `${SIDEBAR_CONTENT_FADE_MS}ms`,
    "--notes-visibility-delay": sidebarCollapsed
      ? `${SIDEBAR_CONTENT_FADE_MS}ms`
      : "0s",
    "--notes-split-move-ms": `${splitMoveMs}ms`,
  } as React.CSSProperties;

  const { width: sidebarWidth, setWidth: setSidebarWidth } = useNoteSidebarWidth();
  const [rootWidth, setRootWidth] = useState(0);
  const [sidebarResizing, setSidebarResizing] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const sync = () => {
      const next = el.clientWidth;
      setRootWidth((prev) => (prev === next ? prev : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const maxSidebarWidth = useMemo(() => {
    if (rootWidth <= 0) return NOTE_SIDEBAR_MAX_WIDTH;
    const available = rootWidth - PANEL_RESIZER_WIDTH - NOTES_EDITOR_MIN_WIDTH;
    return Math.max(
      NOTE_SIDEBAR_MIN_WIDTH,
      Math.min(NOTE_SIDEBAR_MAX_WIDTH, available)
    );
  }, [rootWidth]);

  const effectiveSidebarWidth = Math.min(sidebarWidth, maxSidebarWidth);

  const handleResizeSidebar = useCallback(
    (next: number) => setSidebarWidth(next, maxSidebarWidth),
    [setSidebarWidth, maxSidebarWidth]
  );

  const handleResetSidebarWidth = useCallback(
    () => setSidebarWidth(NOTE_SIDEBAR_DEFAULT_WIDTH, maxSidebarWidth),
    [setSidebarWidth, maxSidebarWidth]
  );


  const activeFile = useMemo<FileNode | null>(() => {
    if (!activeRelPath) return null;
    if (activeExternalId) {
      const extTree = externalTrees[activeExternalId];
      return extTree
        ? findFileIn(extTree, activeRelPath, externalTreeChildren[activeExternalId] ?? {})
        : null;
    }
    return findFileIn(tree, activeRelPath, treeChildren);
  }, [
    tree,
    treeChildren,
    externalTrees,
    externalTreeChildren,
    activeRelPath,
    activeExternalId,
  ]);

  const activeRootPath = useMemo(() => {
    if (activeExternalId) {
      return externalFolders.find((f) => f.id === activeExternalId)?.path ?? filePath;
    }
    return filePath;
  }, [activeExternalId, externalFolders, filePath]);

  const saveFolder = activeExternalId ? "" : currentFolder;

  const pendingDeleteExternalName = useMemo(() => {
    const id = pendingDelete?.externalId;
    if (!id) return "";
    return externalFolders.find((f) => f.id === id)?.name ?? "";
  }, [pendingDelete, externalFolders]);

  const createExternalName = useMemo(() => {
    if (!createExternalId) return "";
    return externalFolders.find((f) => f.id === createExternalId)?.name ?? "";
  }, [createExternalId, externalFolders]);

  const [counts, setCounts] = useState<Record<NoteType, number>>(() => {
    const acc = {} as Record<NoteType, number>;
    for (const { type } of NOTE_TYPES) acc[type] = 0;
    return acc;
  });

  const countsStateRef = useRef({ busy: false, dirty: false, dir: "" });

  const refreshCounts = useCallback((dirPath: string) => {
    const state = countsStateRef.current;
    state.dir = dirPath;
    if (state.busy) {
      state.dirty = true;
      return;
    }
    state.busy = true;
    state.dirty = false;

    const run = (dir: string) => {
      void window.electron
        .getNoteCounts(dir)
        .then((next) => {
          if (next) setCounts(next);
        })
        .catch(() => {})
        .finally(() => {
          state.busy = false;
          if (state.dirty) {
            state.dirty = false;
            run(state.dir);
          }
        });
    };
    run(dirPath);
  }, []);

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

  const activeEditorRef = useRef(activeEditor);
  activeEditorRef.current = activeEditor;

  useEffect(() => {
    seenMtimeRef.current = activeFile?.mtime ?? null;
  }, [activeRelPath, activeFile?.mtime]);

  const loadTree = useCallback(async () => {
    const p = await window.electron.getFilePath();
    setFilePath(p);
    if (!p) {
      setTree([]);
      setTreeChildren({});
      return;
    }
    const nodes = await window.electron.getNoteTree(p);
    setTree(nodes);
    treeChildrenRef.current = {};
    setTreeChildren({});
    refreshCounts(p);
  }, [refreshCounts]);

  const loadingChildrenRef = useRef<Set<string>>(new Set());
  const treeChildrenRef = useRef<Record<string, NoteTreeNode[]>>({});
  treeChildrenRef.current = treeChildren;

  const loadTreeChildren = useCallback(
    async (relDir: string) => {
      if (!filePath) return;
      if (loadingChildrenRef.current.has(relDir)) return;
      if (treeChildrenRef.current[relDir] !== undefined) return;
      loadingChildrenRef.current.add(relDir);
      try {
        const nodes = await window.electron.getNoteTreeChildren(filePath, relDir);
        setTreeChildren((prev) => ({ ...prev, [relDir]: nodes ?? [] }));
      } catch (err) {
        console.error("读取子目录失败:", relDir, err);
        setTreeChildren((prev) => ({ ...prev, [relDir]: [] }));
      } finally {
        loadingChildrenRef.current.delete(relDir);
      }
    },
    [filePath]
  );

  const loadPathToFile = useCallback(
    async (relPath: string) => {
      const idx = relPath.lastIndexOf("/");
      if (idx === -1) return;
      let acc = "";
      for (const seg of relPath.slice(0, idx).split("/")) {
        acc = acc ? `${acc}/${seg}` : seg;
        await loadTreeChildren(acc);
      }
    },
    [loadTreeChildren]
  );

  useEffect(() => {
    if (!activeRelPath || activeExternalId) return;
    void loadPathToFile(activeRelPath);
  }, [activeRelPath, activeExternalId, loadPathToFile]);

  const loadExternalFolders = useCallback(async () => {
    try {
      const list = await window.electron.getExternalFolders();
      setExternalFolders(list ?? []);
    } catch (err) {
      console.error("加载外部文件夹清单失败", err);
    }
  }, []);

  const loadExternalTree = useCallback(async (id: string, force = false) => {
    if (!force && externalTreesRef.current[id]) return;
    setLoadingExternal((prev) => new Set(prev).add(id));
    try {
      const nodes = await window.electron.getExternalTree(id);
      setExternalTrees((prev) => ({ ...prev, [id]: nodes }));
      setExternalTreeChildren((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      externalTreeChildrenRef.current = {
        ...externalTreeChildrenRef.current,
        [id]: {},
      };
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

  const loadingExternalChildrenRef = useRef<Set<string>>(new Set());
  const externalTreeChildrenRef = useRef<Record<string, Record<string, NoteTreeNode[]>>>({});
  externalTreeChildrenRef.current = externalTreeChildren;

  const loadExternalTreeChildren = useCallback(async (id: string, relPath: string) => {
    const key = `${id}\u0000${relPath}`;
    if (loadingExternalChildrenRef.current.has(key)) return;
    if (externalTreeChildrenRef.current[id]?.[relPath] !== undefined) return;
    loadingExternalChildrenRef.current.add(key);
    try {
      const nodes = await window.electron.getExternalTreeChildren(id, relPath);
      setExternalTreeChildren((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? {}), [relPath]: nodes ?? [] },
      }));
    } catch (err) {
      console.error("读取外部子目录失败:", relPath, err);
      setExternalTreeChildren((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? {}), [relPath]: [] },
      }));
    } finally {
      loadingExternalChildrenRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    void loadTree();
    void loadExternalFolders();
  }, [loadTree, loadExternalFolders]);

  useEffect(() => {
    if (!isActive || !filePath) return;
    return window.electron.onNotesChanged((root) => {
      if (root !== filePath) return;

      void (async () => {
        const before = activeRelPath ? seenMtimeRef.current : null;
        await loadTree();

        if (!activeRelPath) return;
        const node = await window.electron.getNoteStat(filePath, activeRelPath);
        if (!node) return;

        seenMtimeRef.current = node.mtime;
        if (before === null || node.mtime === before) return;

        const editor = activeEditorRef.current();
        if (!editor) return;

        if (!(editor.isDirty?.() ?? false)) {
          await editor.reload?.();
          return;
        }

        setExternalConflict(activeRelPath);
      })();
    });
  }, [isActive, filePath, activeRelPath, loadTree, activeEditorRef]);

  const handleDiscardLocal = useCallback(async () => {
    setExternalConflict(null);
    const editor = activeEditorRef.current();
    await editor?.reload?.();
    toast({ title: "已载入磁盘上的最新版本", description: "本地未保存的改动已丢弃" });
  }, [toast]);

  const handleKeepLocal = useCallback(() => {
    setExternalConflict(null);
    const node = activeRelPath ? findFileIn(tree, activeRelPath, treeChildren) : null;
    if (node) seenMtimeRef.current = node.mtime;
  }, [activeRelPath, tree, treeChildren]);

  const handleOverwriteDisk = useCallback(async () => {
    setExternalConflict(null);
    const editor = activeEditorRef.current();
    if (!editor?.currentRelPath()) return;
    const ok = await editor.save();
    if (ok) {
      const node = activeRelPath ? findFileIn(tree, activeRelPath, treeChildren) : null;
      if (node) seenMtimeRef.current = node.mtime;
      await loadTree();
      toast({ title: "已保存", description: "本地改动已覆盖磁盘版本" });
    }
  }, [activeRelPath, tree, treeChildren, loadTree, toast]);

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

  const pendingIslandRelPath = useRef<string | null>(null);
  useIslandOpenNote((relPath) => {
    pendingIslandRelPath.current = relPath;
    void loadPathToFile(relPath);
  });
  useEffect(() => {
    const relPath = pendingIslandRelPath.current;
    if (!relPath || !filePath) return;
    void loadPathToFile(relPath);
  }, [filePath, loadPathToFile]);
  useEffect(() => {
    const relPath = pendingIslandRelPath.current;
    if (!relPath) return;
    const node = findFileIn(tree, relPath, treeChildren);
    if (!node) return;
    pendingIslandRelPath.current = null;
    handleOpen(node);
  }, [tree, treeChildren, handleOpen]);

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
      const last = lastRelByType[type];
      setActiveRelPath(last?.relPath ?? null);
      setActiveExternalId(last?.externalId ?? null);
    },
    [lastRelByType]
  );

  const handleSaved = useCallback(
    (relPath: string) => {
      setActiveRelPath(relPath);
      setLastRelByType((prev) => ({
        ...prev,
        [activeType]: { relPath, externalId: activeExternalId },
      }));
      void loadTree();
      if (activeExternalId) void loadExternalTree(activeExternalId, true);
    },
    [activeType, activeExternalId, loadTree, loadExternalTree]
  );

  const openSaveModal = useCallback(() => {
    setCustomFileName("");
    setShowSaveModal(true);
  }, []);

  const handleSaveAs = useCallback(() => {
    if (activeType === "image" || activeType === "pdf") return;
    if (!activeEditor()) return;
    openSaveModal();
  }, [activeType, activeEditor, openSaveModal]);

  const handleSaveActive = useCallback(async () => {
    if (savingRef.current) return;
    if (activeType === "image" || activeType === "pdf") return;
    const editor = activeEditor();
    if (!editor) return;
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

  const willOverwrite =
    !!targetRelPath &&
    siblingRelPaths(
      activeExternalId ? externalTrees[activeExternalId] ?? [] : tree,
      saveFolder,
      activeExternalId ? externalTreeChildren[activeExternalId] ?? {} : treeChildren
    ).includes(targetRelPath);

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

  const handleDeleteConfirm = useCallback(async () => {
    if (pendingDelete) {
      const { node, externalId } = pendingDelete;
      const isFolder = node.kind === "folder";
      const isFile = node.kind === "file";

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
          if (isFile && activeExternalId === externalId && activeRelPath === node.relPath) {
            setActiveRelPath(null);
          }
          await loadExternalTree(externalId, true);
        } else if (isFolder) {
          setCurrentFolder((cur) =>
            cur === node.relPath || cur.startsWith(`${node.relPath}/`) ? "" : cur
          );
          setActiveRelPath((cur) =>
            cur && cur.startsWith(`${node.relPath}/`) ? null : cur
          );
        } else {
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

  const handleRenameStart = useCallback((node: NoteTreeNode) => {
    setRenamingRel(node.relPath);
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
      if (
        siblingRelPaths(tree, parentRel, treeChildren).includes(
          `${parentRel ? parentRel + "/" : ""}${newName}`
        )
      ) {
        toast({ title: "同名条目已存在！", variant: "destructive" });
        return;
      }
      if (!filePath) return;

      setRenaming(true);
      const ok = await window.electron.renameNoteEntry(filePath, node.relPath, newName);
      setRenaming(false);
      if (!ok) return;

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
          if (cur && !cur.externalId) next[type] = { ...cur, relPath: remap(cur.relPath) };
        }
        return next;
      });
      void loadTree();
    },
    [renameValue, tree, treeChildren, filePath, currentFolder, loadTree, toast]
  );

  const handleChangePath = useCallback(async () => {
    const newPath = await window.electron.selectDirs();
    if (newPath) {
      setCurrentFolder("");
      setActiveRelPath(null);
      setLastRelByType(
        NOTE_TYPES.reduce(
          (acc, { type }) => ({ ...acc, [type]: null }),
          {} as Record<NoteType, { relPath: string; externalId: string | null } | null>
        )
      );
      void loadTree();
    }
  }, [loadTree]);

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
    if (activeExternalId) {
      const target = resolveExplorerTarget();
      try {
        const ok = await window.electron.revealExternalFile(
          activeExternalId,
          target.relPath,
          target.kind === "reveal" ? "reveal" : "open"
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
        const ok = await window.electron.revealInFolder(filePath, target.relPath);
        if (!ok) {
          toast({ title: "无法定位", description: "文件可能已被移动或删除", variant: "destructive" });
        }
        return;
      }
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

  const handleRevealInExplorer = useCallback(
    async (node: NoteTreeNode) => {
      if (!filePath) return;
      try {
        if (node.kind === "folder") {
          const err = await window.electron.openInExplorer(filePath, node.relPath);
          if (err) {
            toast({ title: "打开失败", description: err, variant: "destructive" });
          }
          return;
        }
        const ok = await window.electron.revealInFolder(filePath, node.relPath);
        if (!ok) {
          toast({
            title: "无法定位",
            description: "文件可能已被移动或删除",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("在文件管理器中定位失败:", error);
        toast({
          title: "打开失败",
          description: error instanceof Error ? error.message : "未知错误",
          variant: "destructive",
        });
      }
    },
    [filePath, toast]
  );

  const handleRevealExternal = useCallback(
    async (folderId: string, node: NoteTreeNode) => {
      try {
        const ok = await window.electron.revealExternalFile(
          folderId,
          node.relPath,
          node.kind === "folder" ? "open" : "reveal"
        );
        if (!ok) {
          toast({
            title: "无法定位",
            description: "文件可能已被移动或删除",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("在文件管理器中定位外部条目失败:", error);
        toast({
          title: "打开失败",
          description: error instanceof Error ? error.message : "未知错误",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const handleOpenExternalFolder = useCallback(
    async (folder: ExternalFolder) => {
      try {
        const ok = await window.electron.revealExternalFile(folder.id, "", "open");
        if (!ok) {
          toast({
            title: "无法打开",
            description: "文件夹可能已被移动或删除",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("打开外部文件夹失败:", error);
        toast({
          title: "打开失败",
          description: error instanceof Error ? error.message : "未知错误",
          variant: "destructive",
        });
      }
    },
    [toast]
  );


  const handleAddExternalFolder = useCallback(async () => {
    try {
      const list = await window.electron.addExternalFolders();
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

  const handleRemoveExternalFolder = useCallback(
    async (id: string) => {
      const folder = externalFolders.find((f) => f.id === id);
      try {
        const list = await window.electron.removeExternalFolder(id);
        setExternalFolders(list ?? []);
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


  const handleExternalDelete = useCallback(
    (folder: ExternalFolder, node: NoteTreeNode) => {
      setPendingDelete({ node, externalId: folder.id });
      setShowDeleteModal(true);
    },
    []
  );

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

  const handleExternalCreateFolder = useCallback(
    (folder: ExternalFolder, target: string) => {
      setCreateTarget(target);
      setCreateExternalId(folder.id);
      setFolderName("");
      setShowFolderModal(true);
    },
    []
  );

  const handleExternalCreateFile = useCallback(
    (folder: ExternalFolder, type: NoteType, target: string) => {
      setCreateTarget(target);
      setCreateExternalId(folder.id);
      setCreatingType(type);
      setNewFileName("未命名");
    },
    []
  );

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


  const handleTreeDelete = useCallback((node: NoteTreeNode) => {
    setPendingDelete({ node, externalId: null });
    setShowDeleteModal(true);
  }, []);

  const handleRenameCancel = useCallback(() => setRenamingRel(null), []);

  const handleTreeCreateFolder = useCallback(
    (target: string) => handleCreateFolderStart(target),
    [handleCreateFolderStart]
  );

  const handleTreeRefresh = useCallback(() => void loadTree(), [loadTree]);

  const handleToggleExternalFolder = useCallback(
    (id: string) => void loadExternalTree(id),
    [loadExternalTree]
  );

  const handleAddExternal = useCallback(() => void handleAddExternalFolder(), [
    handleAddExternalFolder,
  ]);

  const handleRemoveExternal = useCallback(
    (id: string) => void handleRemoveExternalFolder(id),
    [handleRemoveExternalFolder]
  );

  const handleRefreshExternal = useCallback(() => {
    for (const id of Object.keys(externalTrees)) void loadExternalTree(id, true);
  }, [externalTrees, loadExternalTree]);

  const handleExternalRenameConfirm = useCallback(
    (folder: ExternalFolder, node: NoteTreeNode, name: string) =>
      void handleExternalRename(folder, node, name),
    [handleExternalRename]
  );

  const handleExternalMoveEntry = useCallback(
    (folder: ExternalFolder, from: string, to: string) =>
      void handleExternalMove(folder, from, to),
    [handleExternalMove]
  );

  const handleExternalImport = useCallback(
    (folder: ExternalFolder, paths: string[]) =>
      void handleExternalImportFiles(folder, paths),
    [handleExternalImportFiles]
  );

  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        if (e.key === "F2" && !isEditable(e.target) && activeRelPath) {
          const node = findFileIn(tree, activeRelPath, treeChildren);
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
        e.preventDefault();
        void handleSaveActive();
        return;
      }

      if (key === "v" && !e.shiftKey && !e.altKey && filePath) {
        if (isEditable(e.target)) return;
        if (excalidrawContainerRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        void (async () => {
          const entry = await window.electron.saveClipboardImageNote(filePath, currentFolder);
          if (!entry) return;
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
    treeChildren,
    activeRelPath,
    currentFolder,
    loadTree,
    handleSaveAs,
    handleSaveActive,
    handleRenameStart,
    toast,
  ]);

  useEffect(() => {
    if (!isActive) return;
    const onMouseDown = (e: MouseEvent) => {
      if (renamingRel === null) return;
      if ((e.target as HTMLElement | null)?.closest?.("[data-rename-input]")) return;
      const node = findNodeIn(tree, renamingRel, treeChildren);
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
  }, [isActive, renamingRel, renameValue, tree, treeChildren]);

  const typeLabel = getNoteTypeMeta(activeType).label;

  return (
    <TooltipProvider delayDuration={300}>
      {
}
      <div ref={rootRef} className="flex h-full w-full relative">
        {
}
        <div
          data-notes-sidebar
          className={`relative z-10 h-full shrink-0 flex flex-col p-0 overflow-hidden transition-[width] motion-reduce:transition-none ${
            sidebarCollapsing ? "duration-150" : "duration-panel"
          } ${sidebarCollapsed ? "" : "border-r border-border/60"}`}
          style={{
            width: sidebarCollapsed ? NOTE_SIDEBAR_COLLAPSED_WIDTH : effectiveSidebarWidth,
            ...(sidebarCollapsed
              ? { boxShadow: "inset -1px 0 0 0 hsl(var(--border) / 0.6)" }
              : null),
            ...(sidebarResizing ? { transitionProperty: "none" } : null),
          }}
        >
          {
}
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
              <h3 className="text-sm font-medium ml-2 text-left flex-1 text-foreground">
                笔记
              </h3>
            )}
          </div>

          {
}
          {sidebarContentMounted && (
            <>
              {
}
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

              {
}
              <div className="flex-1 min-h-0 flex flex-col">
                {}
                <div
                  data-notes-split="tree"
                  data-split-ratio={externalRatio}
                  style={{
                    ...splitTransitionVars,
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: mainTreeBasis,
                    ...(splitResizing ? { transitionProperty: "none" } : null),
                  }}
                  className={`notes-split-transition min-h-0 px-2 overflow-hidden flex flex-col ${sidebarContentStateClass}`}
                >
                  <NoteFileList
                    nodes={tree}
                    childrenMap={treeChildren}
                    onLoadChildren={loadTreeChildren}
                    activeRelPath={activeRelPath}
                    currentFolder={currentFolder}
                    renamingRel={renamingRel}
                    renameValue={renameValue}
                    renaming={renaming}
                    onOpen={handleOpen}
                    onRevealInFolder={handleRevealInExplorer}
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

                {
}
                <PanelHeightResizer
                  ratio={externalRatio}
                  minRatio={NOTES_SPLIT_MIN_RATIO}
                  maxRatio={NOTES_SPLIT_MAX_RATIO}
                  onResize={setExternalRatio}
                  onReset={resetExternalRatio}
                  disabled={externalCollapsed}
                  onDraggingChange={setSplitResizing}
                />

                {
}
                <div
                  data-notes-split="external"
                  data-split-ratio={externalRatio}
                  style={{
                    ...splitTransitionVars,
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: externalBasis,
                    ...(splitResizing ? { transitionProperty: "none" } : null),
                  }}
                  className={`notes-split-transition min-h-0 px-2 py-1.5 overflow-hidden flex flex-col ${sidebarContentStateClass}`}
                >
                  <NoteExternalFolders
                    folders={externalFolders}
                    trees={externalTrees}
                    childrenByFolder={externalTreeChildren}
                    onLoadChildren={loadExternalTreeChildren}
                    loadingIds={loadingExternal}
                    onToggleFolder={handleToggleExternalFolder}
                    onAdd={handleAddExternal}
                    onRemove={handleRemoveExternal}
                    onRefresh={handleRefreshExternal}
                    onOpenFile={handleOpenExternal}
                    onRevealInFolder={(folder, node) =>
                      void handleRevealExternal(folder.id, node)
                    }
                    onOpenFolder={(folder) => void handleOpenExternalFolder(folder)}
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

        {
}
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

        {}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            className="flex items-center gap-3 px-4 h-12 flex-shrink-0 border-b"
            style={{ borderColor: "hsl(var(--divider))" }}
          >
            <NoteTypeTabs active={activeType} onChange={handleTypeChange} counts={counts} />
            {
}
            <span
              className="text-xs text-muted-foreground truncate min-w-0 ml-auto"
              title={activeRelPath ?? undefined}
            >
              {activeFile
                ? activeExternalId
                  ?
                    `${externalFolders.find((f) => f.id === activeExternalId)?.name ?? "外部文件夹"}/${activeFile.relPath}`
                  : activeFile.relPath
                : `${typeLabel} · 未打开文件`}
            </span>
          </div>

          <div className="flex-1 min-h-0 relative">
            {
}
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

        {}
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

        {}
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

        {
}
        {showDeleteModal && pendingDelete && (
          <Dialog
            open={showDeleteModal}
            onOpenChange={(isOpen) => {
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
                        {typeof pendingDelete.node.childCount === "number" && (
                          <>其中的 {pendingDelete.node.childCount} 个条目会一并永久删除，无法恢复。</>
                        )}
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
              const node = findNodeIn(tree, renamingRel, treeChildren);
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
