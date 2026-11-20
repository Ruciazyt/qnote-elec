import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight,
  Trash2,
  Pencil,
  Upload,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getNoteTypeMeta,
  NoteTreeNode,
  NoteType,
  stripExt,
} from "../../../shared/notes/noteTypes";
import { NOTE_TYPE_ICONS } from "./noteIcons";
import NoteTreeMenu, { NoteTreeMenuTarget } from "./NoteTreeMenu";
import { cn } from "@/lib/utils";

const EMPTY_CHILDREN: Record<string, NoteTreeNode[]> = {};

function relativeTime(mtime: number): string {
  const diff = Date.now() - mtime;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(mtime).toLocaleDateString("zh-CN");
}

interface NoteFileListProps {
  nodes: NoteTreeNode[];
  childrenMap?: Record<string, NoteTreeNode[]>;
  onLoadChildren?: (relPath: string) => void;
  activeRelPath: string | null;
  currentFolder: string;
  renamingRel: string | null;
  renameValue: string;
  renaming: boolean;
  onOpen: (node: Extract<NoteTreeNode, { kind: "file" }>) => void;
  onRevealInFolder?: (node: NoteTreeNode) => void;
  onPickFolder: (relPath: string) => void;
  onDelete: (node: NoteTreeNode) => void;
  onRenameStart: (node: NoteTreeNode) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: (node: NoteTreeNode) => void;
  onRenameCancel: () => void;
  onRefresh?: () => void;
  onImportFiles?: (paths: string[]) => void;
  onCreateFolder: (targetFolder: string) => void;
  onCreateFile?: (type: NoteType, targetFolder: string) => void;
  canCreateFile?: boolean;
  createTargetFolder?: string;
  onMove: (fromRel: string, toFolderRel: string) => void;
  fileListRef?: React.RefObject<HTMLDivElement>;
  fill?: boolean;
  scrollInset?: boolean;
  depthOffset?: number;
}

function focusOnMount(node: HTMLInputElement | null) {
  if (node) node.focus();
}

function RenameInput({
  value,
  busy,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      data-rename-input
      className="flex-1 min-w-0 h-6 bg-background border border-primary/50 rounded px-1.5 text-xs outline-none ring-2 ring-primary/25"
      value={value}
      ref={focusOnMount}
      disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onConfirm();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

function RowActions({
  name,
  onRename,
  onDelete,
}: {
  name: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  const btn =
    "h-6 w-6 rounded flex items-center justify-center transition-colors duration-150 active:scale-90";
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0" role="group" aria-label="笔记操作">
      <button
        type="button"
        className={cn(btn, "text-muted-foreground hover:text-primary")}
        aria-label={`重命名 ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        onKeyDown={(e) => e.stopPropagation()}>
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        className={cn(btn, "text-muted-foreground hover:text-destructive")}
        aria-label={`删除 ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onKeyDown={(e) => e.stopPropagation()}>
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function NoteFileList({
  nodes,
  childrenMap,
  onLoadChildren,
  activeRelPath,
  currentFolder,
  renamingRel,
  renameValue,
  renaming,
  onOpen,
  onRevealInFolder,
  onPickFolder,
  onDelete,
  onRenameStart,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  onRefresh,
  onImportFiles,
  onCreateFolder,
  onCreateFile,
  canCreateFile = true,
  createTargetFolder = "",
  onMove,
  fileListRef,
  fill = true,
  scrollInset = true,
  depthOffset = 0,
}: NoteFileListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragRel, setDragRel] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    target: NoteTreeMenuTarget;
  } | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = (rel: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });

  const clearExpandTimer = () => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };
  useEffect(() => clearExpandTimer, []);

  const expandAncestors = (prev: Set<string>, path: string): Set<string> => {
    if (!path) return prev;
    const next = new Set(prev);
    const segs = path.split("/");
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      next.add(acc);
    }
    if (next.size === prev.size) return prev;
    return next;
  };

  const expandParentDirs = (prev: Set<string>, filePath: string): Set<string> => {
    if (!filePath) return prev;
    const idx = filePath.lastIndexOf("/");
    if (idx === -1) return prev;
    const next = new Set(prev);
    let acc = "";
    for (const seg of filePath.slice(0, idx).split("/")) {
      acc = acc ? `${acc}/${seg}` : seg;
      next.add(acc);
    }
    if (next.size === prev.size) return prev;
    return next;
  };

  useEffect(() => {
    setExpanded((prev) => expandAncestors(prev, currentFolder));
  }, [currentFolder]);

  useEffect(() => {
    setExpanded((prev) => expandAncestors(prev, createTargetFolder));
  }, [createTargetFolder]);

  useEffect(() => {
    setExpanded((prev) => expandParentDirs(prev, activeRelPath ?? ""));
  }, [activeRelPath]);

  const childMap = childrenMap ?? EMPTY_CHILDREN;

  const loadChildrenRef = useRef(onLoadChildren);
  loadChildrenRef.current = onLoadChildren;

  useEffect(() => {
    const load = loadChildrenRef.current;
    if (!load) return;
    for (const rel of expanded) {
      if (childMap[rel] === undefined) load(rel);
    }
  }, [expanded, childMap]);

  const endDrag = () => {
    clearExpandTimer();
    setDragRel(null);
    setDropTarget(null);
  };

  const folderDropHandlers = (nodeRel: string, isOpen: boolean) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragRel || dragRel === nodeRel) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(nodeRel);
      if (!isOpen) {
        clearExpandTimer();
        expandTimerRef.current = setTimeout(() => {
          setExpanded((prev) => (prev.has(nodeRel) ? prev : new Set(prev).add(nodeRel)));
        }, 600);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDropTarget((t) => (t === nodeRel ? null : t));
      clearExpandTimer();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const from = e.dataTransfer.getData("text/qnote-rel") || dragRel;
      endDrag();
      if (from && from !== nodeRel) onMove(from, nodeRel);
    },
  });

  const dragSourceProps = (nodeRel: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/qnote-rel", nodeRel);
      e.dataTransfer.effectAllowed = "move";
      setDragRel(nodeRel);
    },
    onDragEnd: endDrag,
  });

  const rootDropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!dragRel) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (e.currentTarget === e.target) setDropTarget("");
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/qnote-rel") || dragRel;
      endDrag();
      if (from) onMove(from, "");
    },
  };

  const openContextMenu = (e: React.MouseEvent, target: NoteTreeMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  };

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  const handleReveal = useCallback(() => {
    const node = ctxMenu?.target.node;
    if (!node || !onRevealInFolder) return;
    onRevealInFolder(node);
  }, [ctxMenu, onRevealInFolder]);

  const renderNodes = (list: NoteTreeNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      const isRenaming = node.relPath === renamingRel;
      const isOpen = expanded.has(node.relPath);
      const isActiveFolder = node.kind === "folder" && node.relPath === currentFolder;
      const pickFolder = () => onPickFolder(isActiveFolder ? "" : node.relPath);
      const showActions = !isRenaming && (hovered === node.relPath || node.relPath === activeRelPath);

      if (isRenaming) {
        return (
          <div
            key={node.relPath}
            className="flex items-center gap-1.5 h-7 px-1.5 rounded-md bg-accent"
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            {node.kind === "folder" ? (
              <FolderOpenIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <span className="w-3.5 flex-shrink-0" />
            )}
            <RenameInput
              value={renameValue}
              busy={renaming}
              onChange={onRenameChange}
              onConfirm={() => onRenameConfirm(node)}
              onCancel={onRenameCancel}
            />
          </div>
        );
      }

      if (node.kind === "folder") {
        const loadedChildren = childMap[node.relPath];
        const kids = loadedChildren ?? node.children ?? [];
        const kidCount = loadedChildren ? loadedChildren.length : node.childCount;
        const kidsPending = loadedChildren === undefined && !!onLoadChildren;
        return (
          <React.Fragment key={node.relPath}>
            <div
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHovered(node.relPath)}
              onMouseLeave={() => setHovered((h) => (h === node.relPath ? null : h))}
              onClick={pickFolder}
              onContextMenu={(e) =>
                openContextMenu(e, { kind: "folder", node, folderRel: node.relPath })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pickFolder();
                }
                if (e.key === "F2") {
                  e.preventDefault();
                  onRenameStart(node);
                }
              }}
              className={cn(
                "group flex items-center gap-1 h-7 pr-1.5 rounded-md cursor-pointer transition-colors duration-150 note-row",
                isActiveFolder ? "note-row-active text-foreground" : "hover:bg-accent",
                dropTarget === node.relPath &&
                  "!border border-dashed border-primary bg-primary/10 ring-1 ring-primary/40",
                dragRel === node.relPath && "opacity-40"
              )}
              style={{ paddingLeft: 6 + depth * 12 }}
              title={`${node.relPath}（点击设为新建与导入的落点，再点一次取消；可拖入文件）`}
              {...dragSourceProps(node.relPath)}
              {...folderDropHandlers(node.relPath, isOpen)}
            >
              <span
                role="button"
                tabIndex={-1}
                aria-label={isOpen ? "折叠" : "展开"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.relPath);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(node.relPath);
                  }
                }}
                className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/70 hover:text-foreground flex-shrink-0 rounded"
              >
                <ChevronRight className={cn("h-3 w-3 transition-transform duration-150", isOpen && "rotate-90")} />
              </span>
              {isOpen ? (
                <FolderOpenIcon className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              ) : (
                <FolderIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              )}
              {}
              <span className="flex-1 min-w-0 truncate text-xs">{node.name}</span>
              {typeof kidCount === "number" && kidCount >= 0 && (
                <span className="text-[10px] text-muted-foreground/50 tabular-nums flex-shrink-0">
                  {kidCount}
                </span>
              )}
              {}
              <div className="w-[46px] flex justify-end flex-shrink-0">
                {(showActions || isActiveFolder) && (
                  <RowActions
                    name={node.name}
                    onRename={() => onRenameStart(node)}
                    onDelete={() => onDelete(node)}
                  />
                )}
              </div>
            </div>
            {isOpen &&
              (kidsPending ? (
                <div
                  className="flex items-center h-6 text-[11px] text-muted-foreground/60"
                  style={{ paddingLeft: 6 + (depth + 1) * 12 + 18 }}
                >
                  正在读取…
                </div>
              ) : (
                renderNodes(kids, depth + 1)
              ))}
          </React.Fragment>
        );
      }

      const Icon = NOTE_TYPE_ICONS[node.type];
      const label = getNoteTypeMeta(node.type).label;
      const parentRel = node.relPath.includes("/")
        ? node.relPath.slice(0, node.relPath.lastIndexOf("/"))
        : "";
      return (
        <div
          key={node.relPath}
          role="button"
          tabIndex={0}
          onMouseEnter={() => setHovered(node.relPath)}
          onMouseLeave={() => setHovered((h) => (h === node.relPath ? null : h))}
          onClick={() => onOpen(node)}
          onContextMenu={(e) => openContextMenu(e, { kind: "file", node, folderRel: parentRel })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(node);
            }
            if (e.key === "F2") {
              e.preventDefault();
              onRenameStart(node);
            }
          }}
          className={cn(
            "group flex items-center gap-1 h-7 pr-1.5 rounded-md cursor-pointer transition-colors duration-150 note-row",
            node.relPath === activeRelPath
              ? "note-row-active text-foreground"
              : "hover:bg-accent",
            dragRel === node.relPath && "opacity-40"
          )}
          style={{ paddingLeft: 6 + depth * 12 + 18 }}
          title={`${node.relPath}（拖到文件夹上可移动）`}
          {...dragSourceProps(node.relPath)}
        >
          <Icon
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0",
              node.relPath === activeRelPath ? "text-primary" : "text-muted-foreground/70"
            )}
          />
          <span className="flex-1 min-w-0 truncate text-xs">{stripExt(node.name)}</span>
          <span className="text-[10px] text-muted-foreground/55 flex-shrink-0">{label}</span>
          {}
          <div className="w-[46px] flex justify-end flex-shrink-0">
            {showActions ? (
              <RowActions
                name={node.name}
                onRename={() => onRenameStart(node)}
                onDelete={() => onDelete(node)}
              />
            ) : (
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                {relativeTime(node.mtime)}
              </span>
            )}
          </div>
        </div>
      );
    });

  const isEmpty = nodes.length === 0;

  const [fileDropActive, setFileDropActive] = useState(false);
  const hasOsFiles = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types ?? []).includes("Files");

  const handleOsFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFileDropActive(false);
    if (!hasOsFiles(e) || !onImportFiles) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    const paths = files
      .map((f) => {
        try {
          return window.electron.getPathForFile(f);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (paths.length > 0) onImportFiles(paths);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex flex-col min-h-0 relative rounded-xl transition-all duration-200 ease-out",
          fill ? "h-full" : "h-auto",
          fileDropActive
            ? "bg-primary/[0.04] ring-1 ring-dashed ring-primary/50"
            : "ring-1 ring-transparent"
        )}
        ref={fileListRef}
        onDragOver={(e) => {
          if (!hasOsFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setFileDropActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setFileDropActive(false);
        }}
        onDrop={handleOsFileDrop}>
        {
}
        <div
          aria-hidden={!fileDropActive}
          className={`absolute inset-0 z-10 flex items-center justify-center rounded-xl
            bg-background/70 backdrop-blur-[1px] transition-opacity duration-200 ease-out
            ${fileDropActive ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="flex flex-col items-center gap-1.5 text-center px-4">
            <Upload className="h-6 w-6 text-primary/80" />
            <p className="text-xs font-medium text-foreground/80">松开即可导入</p>
            <p className="text-[10px] text-muted-foreground/70">
              到「{currentFolder || "根目录"}」· 仅笔记类型
            </p>
          </div>
        </div>
        {
}
        <div
          data-note-tree-scroll
          className={cn(
            fill ? "flex-1 min-h-0" : "flex-none",
            "overflow-y-auto pt-1 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
            scrollInset ? "px-1" : "px-0",
            dropTarget === "" &&
              dragRel &&
              "bg-primary/5 outline outline-2 outline-dashed outline-primary/40 -outline-offset-2"
          )}
          {...rootDropProps}
          onContextMenu={(e) =>
            openContextMenu(e, { kind: "blank", node: null, folderRel: currentFolder })
          }
        >
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-10 leetcode-empty-state">
              <div className="relative mb-4">
                <div className="absolute inset-0 bg-primary/10 rounded-full blur-xl scale-75" />
                <div className="relative w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center animate-float icon-glow-ring">
                  <FolderOpenIcon className="h-6 w-6 text-primary/60" />
                </div>
              </div>
              <p className="text-sm font-medium text-foreground/70 mb-1">还没有笔记</p>
              <p className="text-xs text-muted-foreground text-center max-w-[190px] leading-relaxed">
                右键空白处新建，
                <br />
                右键文件夹则建在那个文件夹里
                <br />
                复制图片后按 Ctrl+V 存为图片笔记
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">{renderNodes(nodes, depthOffset)}</div>
          )}
        </div>
      </div>

      {}
      {ctxMenu && (
        <NoteTreeMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          target={ctxMenu.target}
          canCreate={canCreateFile}
          onClose={closeContextMenu}
          onCreateFile={(type) => onCreateFile?.(type, ctxMenu.target.folderRel)}
          onCreateFolder={() => onCreateFolder(ctxMenu.target.folderRel)}
          onRename={() => {
            if (ctxMenu.target.node) onRenameStart(ctxMenu.target.node);
          }}
          onDelete={() => {
            if (ctxMenu.target.node) onDelete(ctxMenu.target.node);
          }}
          onOpen={
            ctxMenu.target.kind === "file"
              ? () => {
                  const node = ctxMenu.target.node;
                  if (node && node.kind === "file") onOpen(node);
                }
              : undefined
          }
          onReveal={ctxMenu.target.node && onRevealInFolder ? handleReveal : undefined}
          onRefresh={onRefresh ? () => onRefresh() : undefined}
        />
      )}
    </TooltipProvider>
  );
}

export default React.memo(NoteFileList);
