import React, { useEffect, useRef, useState } from "react";
import {
  PenTool,
  FileText,
  ImageIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight,
  Trash2,
  Pencil,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Upload,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CREATABLE_NOTE_TYPES,
  getNoteTypeMeta,
  NoteTreeNode,
  NoteType,
  stripExt,
} from "../../../shared/noteTypes";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<NoteType, React.ElementType> = {
  excalidraw: PenTool,
  markdown: FileText,
  html: Code2,
  image: ImageIcon,
  pdf: FileText,
};

/** 相对时间：比绝对时间戳更容易判断"刚保存的那个是哪个" */
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
  /** 当前打开的文件 relPath */
  activeRelPath: string | null;
  /** 新建笔记的落盘目录；"" 表示根目录 */
  currentFolder: string;
  /** 正在重命名的条目 relPath */
  renamingRel: string | null;
  renameValue: string;
  renaming: boolean;
  onOpen: (node: Extract<NoteTreeNode, { kind: "file" }>) => void;
  onPickFolder: (relPath: string) => void;
  onDelete: (node: NoteTreeNode) => void;
  onRenameStart: (node: NoteTreeNode) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: (node: NoteTreeNode) => void;
  onRenameCancel: () => void;
  /** 刷新目录树（外部改动文件后手动拉一次） */
  onRefresh?: () => void;
  /** 从系统拖入文件 */
  onImportFiles?: (paths: string[]) => void;
  onCreateFolder: () => void;
  /** 新建空白笔记；参数是笔记类型（后缀由类型决定） */
  onCreateFile?: (type: NoteType) => void;
  /** 没设置笔记目录时禁掉新建入口 */
  canCreateFile?: boolean;
  /** 拖拽移动：把 fromRel 放进 toFolderRel（"" 表示根目录） */
  onMove: (fromRel: string, toFolderRel: string) => void;
  fileListRef: React.RefObject<HTMLDivElement>;
}

/** 行内重命名输入框 */
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
      // 供 NotesPage 的"点击外部退出重命名"判断使用：只有点在输入框上才不算点到别处
      data-rename-input
      className="flex-1 min-w-0 h-6 bg-background border border-primary/50 rounded px-1.5 text-xs outline-none ring-2 ring-primary/25"
      value={value}
      autoFocus
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

/** 行尾操作按钮 —— 悬停/选中时占据时间的位置，不产生布局跳动 */
function RowActions({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) {
  const btn =
    "h-6 w-6 rounded flex items-center justify-center transition-colors duration-150 active:scale-90";
  return (
    <div
      className="flex items-center gap-0.5 flex-shrink-0"
      role="group"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 键盘事件同样要拦住：否则回车会连父级行的打开动作一起触发
        e.stopPropagation();
      }}
    >
      <button type="button" className={cn(btn, "text-muted-foreground hover:text-primary")} aria-label="重命名" onClick={onRename}>
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        className={cn(btn, "text-muted-foreground hover:text-destructive")}
        aria-label="删除"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function NoteFileList({
  nodes,
  activeRelPath,
  currentFolder,
  renamingRel,
  renameValue,
  renaming,
  onOpen,
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
  onMove,
  fileListRef,
}: NoteFileListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  /** 正在拖拽的条目 relPath */
  const [dragRel, setDragRel] = useState<string | null>(null);
  /** 当前高亮的放置目标；null = 无目标，"" = 根目录 */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** 「新建文件」类型菜单的开关 */
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  /** 悬停自动展开的计时器 */
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

  /**
   * 「新建位置」指向的文件夹自动展开（连同它的祖先）。
   *
   * 不展开的话，新建的文件落进了目录却看不见 —— 用户会以为没建成功。
   * 祖先也得展开，深层目录里的文件否则仍然藏在折叠层下面。
   */
  useEffect(() => {
    if (!currentFolder) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      const segs = currentFolder.split("/");
      let acc = "";
      for (const seg of segs) {
        acc = acc ? `${acc}/${seg}` : seg;
        next.add(acc);
      }
      // 已经全展开就别产生新 Set，省一次渲染
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [currentFolder]);

  const endDrag = () => {
    clearExpandTimer();
    setDragRel(null);
    setDropTarget(null);
  };

  /** 文件夹行作为放置目标 */
  const folderDropHandlers = (nodeRel: string, isOpen: boolean) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragRel || dragRel === nodeRel) return;
      // 不 preventDefault 的话 drop 事件根本不会触发
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
      // 只在真正移出该行时清高亮，否则在子元素间移动会闪烁
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

  /** 条目行作为拖拽源（文件和文件夹都能拖） */
  const dragSourceProps = (nodeRel: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // Chromium 里必须 setData 才会真正开始拖拽
      e.dataTransfer.setData("text/qnote-rel", nodeRel);
      e.dataTransfer.effectAllowed = "move";
      setDragRel(nodeRel);
    },
    onDragEnd: endDrag,
  });

  /** 列表空白处 = 拖回根目录 */
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

  /** 递归渲染。缩进用 paddingLeft，避免每层多包一个 div */
  const renderNodes = (list: NoteTreeNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      const isRenaming = node.relPath === renamingRel;
      const isOpen = expanded.has(node.relPath);
      const isActiveFolder = node.kind === "folder" && node.relPath === currentFolder;
      // 再点一次已选中的文件夹 → 取消选中，回落到根目录（""），否则没法切回根目录新建
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
        return (
          <React.Fragment key={node.relPath}>
            <div
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHovered(node.relPath)}
              onMouseLeave={() => setHovered((h) => (h === node.relPath ? null : h))}
              onClick={pickFolder}
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
                // 拖拽放置目标：虚线描边 + 浅底色，比整行变色更容易辨认
                dropTarget === node.relPath &&
                  "!border border-dashed border-primary bg-primary/10 ring-1 ring-primary/40",
                // 正在被拖走的行压暗
                dragRel === node.relPath && "opacity-40"
              )}
              style={{ paddingLeft: 6 + depth * 12 }}
              title={`${node.relPath}（点击设为新建位置，再点一次取消；可拖入文件）`}
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
                  // 展开/收起是独立于「选中文件夹」的动作，
                  // 键盘上同样要能触发，且不能顺带把父级行的选中一起做掉
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
              {/* 文件夹名不加粗：左侧列表整体走轻量字重，选中只靠底色区分 */}
              <span className="flex-1 min-w-0 truncate text-xs">{node.name}</span>
              <span className="text-[10px] text-muted-foreground/50 tabular-nums flex-shrink-0">
                {node.childCount}
              </span>
              {/* 选中为新建位置时始终露出操作按钮，否则只有悬停才有 */}
              <div className="w-[46px] flex justify-end flex-shrink-0">
                {(showActions || isActiveFolder) && (
                  <RowActions
                    onRename={() => onRenameStart(node)}
                    onDelete={() => onDelete(node)}
                  />
                )}
              </div>
            </div>
            {isOpen && renderNodes(node.children, depth + 1)}
          </React.Fragment>
        );
      }

      const Icon = TYPE_ICONS[node.type];
      const label = getNoteTypeMeta(node.type).label;
      return (
        <div
          key={node.relPath}
          role="button"
          tabIndex={0}
          onMouseEnter={() => setHovered(node.relPath)}
          onMouseLeave={() => setHovered((h) => (h === node.relPath ? null : h))}
          onClick={() => onOpen(node)}
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
          {/* 时间与按钮共用一个固定宽度槽位，切换时不产生布局位移 */}
          <div className="w-[46px] flex justify-end flex-shrink-0">
            {showActions ? (
              <RowActions
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

  // 系统文件拖入：内部拖动条目时 dataTransfer 带 text/qnote-rel，
  // 那种要交给 folderDropHandlers 走「移动」逻辑，两条路径不能混
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
    // Electron 32+ 移除了 File.path，只能通过 preload 的 webUtils 拿磁盘路径
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
        className={`flex flex-col h-full min-h-0 relative rounded-xl transition-all duration-200 ease-out ${
          // ring 跟着 border-radius 走，所以圆角加在容器上而不是环上；
          // 1px + 虚线比 2px 实心轻，拖过的时候不糊住整个列表
          fileDropActive
            ? "bg-primary/[0.04] ring-1 ring-dashed ring-primary/50"
            : "ring-1 ring-transparent"
        }`}
        ref={fileListRef}
        onDragOver={(e) => {
          if (!hasOsFiles(e)) return; // 内部拖动交给各自的处理器
          e.preventDefault(); // 不 preventDefault 的话 drop 不会触发
          e.dataTransfer.dropEffect = "copy";
          setFileDropActive(true);
        }}
        onDragLeave={(e) => {
          // 只有真正离开容器才取消高亮：子元素之间的移动也会冒泡 dragleave
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setFileDropActive(false);
        }}
        onDrop={handleOsFileDrop}>
        {/* 拖入时的提示：环做得轻，不给文字反馈用户不知道松手会发生什么。
            pointer-events-none —— 绝对不能挡住 drop 事件 */}
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
        <div className="flex items-center justify-between gap-1 px-1 mb-1 flex-shrink-0">
          {/* flex-1 + min-w-0：位置文字长了就截断，不能把右边的按钮挤出可视区 */}
          <span className="flex-1 min-w-0 text-[10px] text-muted-foreground/60 truncate">
            {dragRel
              ? "拖到文件夹上移动，拖到空白处移回根目录"
              : currentFolder
              ? `新建位置：${currentFolder}`
              : "新建位置：根目录"}
          </span>
          {/* 新建文件：先选类型，再由父组件弹命名框落地。
              触发按钮用原生 title 而不是 Tooltip —— Radix 的 Popover 与 Tooltip
              都靠 asChild 克隆同一个按钮，两个触发器叠在一起会互相抢事件。 */}
          {onCreateFile && (
            <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="新建笔记文件"
                  title={canCreateFile ? "新建笔记文件" : "请先设置笔记保存目录"}
                  disabled={!canCreateFile}
                  className="h-6 w-6 flex-shrink-0 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-90 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-52 p-1">
                <p className="px-2 py-1.5 text-[10px] text-muted-foreground/70">
                  在「{currentFolder || "根目录"}」下新建
                </p>
                {CREATABLE_NOTE_TYPES.map((type) => {
                  const meta = getNoteTypeMeta(type);
                  const Icon = TYPE_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        // 选完就收起菜单：否则弹窗叠在菜单下面，用户以为没点上
                        setCreateMenuOpen(false);
                        onCreateFile(type);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors text-left"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1">{meta.label}</span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">
                        {meta.defaultExt}
                      </span>
                    </button>
                  );
                })}
                <p className="px-2 py-1.5 mt-1 border-t border-border/60 text-[10px] text-muted-foreground/60">
                  图片和 PDF 请直接拖入或粘贴
                </p>
              </PopoverContent>
            </Popover>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCreateFolder}
                aria-label="新建文件夹"
                className="h-6 w-6 flex-shrink-0 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-90"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              <p className="text-xs">在「{currentFolder || "根目录"}」下新建文件夹</p>
            </TooltipContent>
          </Tooltip>
          {onRefresh && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onRefresh}
                  aria-label="刷新列表"
                  className="h-6 w-6 flex-shrink-0 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors active:scale-90"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                <p className="text-xs">重新读取笔记目录</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* px-1 / pt-1 给行留出余量：行本身是铺满这个滚动容器宽度的，
            任何画在 border box 外的东西（焦点描边、外投影）都会被 overflow 裁掉。 */}
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto px-1 pt-1 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
            dropTarget === "" &&
              dragRel &&
              "bg-primary/5 outline outline-2 outline-dashed outline-primary/40 -outline-offset-2"
          )}
          {...rootDropProps}
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
              <p className="text-xs text-muted-foreground/60 text-center max-w-[190px] leading-relaxed">
                点上方「新建文件」创建空白笔记，
                <br />
                复制图片后按 Ctrl+V 存为图片笔记
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">{renderNodes(nodes, 0)}</div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
