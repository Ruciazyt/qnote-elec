import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight,
  Trash2,
  Pencil,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getNoteTypeMeta,
  NoteTreeNode,
  NoteType,
  stripExt,
} from "../../../shared/noteTypes";
import { NOTE_TYPE_ICONS } from "./noteIcons";
import NoteTreeMenu, { NoteTreeMenuTarget } from "./NoteTreeMenu";
import { cn } from "@/lib/utils";

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
  /** 新建文件夹；参数是落点目录的相对路径（"" 表示根目录） */
  onCreateFolder: (targetFolder: string) => void;
  /** 新建空白笔记；参数是笔记类型（后缀由类型决定）与落点目录 */
  onCreateFile?: (type: NoteType, targetFolder: string) => void;
  /** 没设置笔记目录时禁掉新建入口 */
  canCreateFile?: boolean;
  /** 当前新建流程的落点目录 —— 变了就把那一层展开，让新建结果看得见 */
  createTargetFolder?: string;
  /** 拖拽移动：把 fromRel 放进 toFolderRel（"" 表示根目录） */
  onMove: (fromRel: string, toFolderRel: string) => void;
  /** 容器 ref —— 外部文件夹区里每个树各自一份，可以不给 */
  fileListRef?: React.RefObject<HTMLDivElement>;
  /**
   * 树要不要撑满父容器
   *
   * 主树：撑满（父容器就是它的可视区）。
   * 外部文件夹区：按内容高度 —— 它嵌在外部区自己的滚动区里，
   * 两层都撑满会出现「套娃滚动」，中间那一层滚不动。
   */
  fill?: boolean;
  /**
   * 滚动区要不要自带左右内边距
   *
   * 主树自己就是滚动区，左右各留 4px（px-1）。
   * 外部区的树是**嵌在**外部区自己的滚动区里的，那层已经带 px-1 ——
   * 再套一层就比主树多缩进 4px，两棵树的行对不齐。
   * 这种场合传 false。
   */
  scrollInset?: boolean;
  /**
   * 整棵树向下挪几级缩进
   *
   * 外部文件夹区里，这棵树挂在「外部文件夹」那一行下面，
   * 不缩进的话父子两级的条目会齐平，看着像同一层。
   */
  depthOffset?: number;
}

/**
 * 输入框挂载时主动聚焦
 *
 * JSX 上的 autoFocus 会被 a11y 规则（jsx-a11y/no-autofocus）判死，
 * 改用 ref 回调：元素挂载的那一刻 focus，跟原来的 autoFocus 行为一致。
 */
function focusOnMount(node: HTMLInputElement | null) {
  if (node) node.focus();
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

/** 行尾操作按钮 —— 悬停/选中时占据时间的位置，不产生布局跳动 */
function RowActions({
  name,
  onRename,
  onDelete,
}: {
  /**
   * 目标条目的名字，逐字来自 node.name。
   *
   * 必须由调用方传进来：名字只有行组件那一层有，
   * 在这里靠 relPath 之类的推算就是另找了一份来源。
   *
   * 它要进可访问名称：文件树一屏有多个条目，
   * 每个按钮都只叫「删除」的话，读屏用户听到的是一串分不清的「删除」
   * （规范 §五「同组重复控件的名称要能互相区分」）。
   * 删除确认框正文里的目标名也是这一份数据（规范 §十 规则 7），
   * 两处必须对得上。
   */
  name: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  const btn =
    "h-6 w-6 rounded flex items-center justify-center transition-colors duration-150 active:scale-90";
  return (
    // 这层容器只负责排版，不挂任何事件：
    // role="group" 是非交互角色，容器上挂 onClick 会被判成
    // 「非交互元素上挂了交互事件」。
    // 拦住冒泡这件事交给按钮自己 —— 按钮点不到的地方本来就不该有动作。
    <div className="flex items-center gap-0.5 flex-shrink-0" role="group" aria-label="笔记操作">
      <button
        type="button"
        className={cn(btn, "text-muted-foreground hover:text-primary")}
        // 名字不截断，也不塞进可见文本 —— 可见的仍是这个图标按钮，
        // 只有可访问名称带上了目标名。
        aria-label={`重命名 ${name}`}
        onClick={(e) => {
          // 拦住冒泡，免得连父级行的「打开笔记」一起触发
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

/**
 * 目录树
 *
 * 出口用 memo 包一层：这棵树是笔记页里最重的一块（行数随目录规模线性增长），
 * 而笔记页的任何一次状态变化（改比例、改宽度、点开一个文件）都会让父组件重渲染。
 * 不包 memo 的话，拖一次分割线就是每帧重建整棵树 —— 分割线卡顿的主因之一。
 *
 * memo 只在 props 引用没变时跳过渲染，所以**父组件传进来的回调必须稳定**
 * （useCallback / setState 直接传），内联箭头函数会让 memo 失效。
 */
function NoteFileList({
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
  createTargetFolder = "",
  onMove,
  fileListRef,
  fill = true,
  scrollInset = true,
  depthOffset = 0,
}: NoteFileListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  /** 正在拖拽的条目 relPath */
  const [dragRel, setDragRel] = useState<string | null>(null);
  /** 当前高亮的放置目标；null = 无目标，"" = 根目录 */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** 右键菜单：视口坐标 + 目标（文件夹 / 文件 / 空白处） */
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    target: NoteTreeMenuTarget;
  } | null>(null);
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
   * 展开某个目录及其全部祖先。
   *
   * 祖先也得展开，深层目录里的条目否则仍然藏在折叠层下面。
   */
  const expandAncestors = (prev: Set<string>, path: string): Set<string> => {
    if (!path) return prev;
    const next = new Set(prev);
    const segs = path.split("/");
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      next.add(acc);
    }
    // 已经全展开就别产生新 Set，省一次渲染
    if (next.size === prev.size) return prev;
    return next;
  };

  /**
   * 「新建位置」指向的文件夹自动展开（连同它的祖先）。
   *
   * 不展开的话，新建的文件落进了目录却看不见 —— 用户会以为没建成功。
   */
  useEffect(() => {
    setExpanded((prev) => expandAncestors(prev, currentFolder));
  }, [currentFolder]);

  /**
   * 右键新建的落点目录也自动展开。
   *
   * 右键某个文件夹新建时，落点不是「新建位置」而是那个文件夹本身 ——
   * 不把它展开的话，新建的条目落在折叠层里看不见。
   */
  useEffect(() => {
    setExpanded((prev) => expandAncestors(prev, createTargetFolder));
  }, [createTargetFolder]);

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

  /**
   * 打开右键菜单
   *
   * 不 preventDefault 的话 Chromium 会弹出它自己的菜单；stopPropagation 是为了
   * 让行上的右键不冒到列表容器上 —— 容器那边是「空白处」的菜单。
   */
  const openContextMenu = (e: React.MouseEvent, target: NoteTreeMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  };

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

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
              onContextMenu={(e) =>
                // 右键文件夹 → 新建项落在这个文件夹里
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
                // 拖拽放置目标：虚线描边 + 浅底色，比整行变色更容易辨认
                dropTarget === node.relPath &&
                  "!border border-dashed border-primary bg-primary/10 ring-1 ring-primary/40",
                // 正在被拖走的行压暗
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
                    name={node.name}
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

      const Icon = NOTE_TYPE_ICONS[node.type];
      const label = getNoteTypeMeta(node.type).label;
      // 文件所在的目录 —— 右键文件时菜单要显示它
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
          {/* 时间与按钮共用一个固定宽度槽位，切换时不产生布局位移 */}
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
        className={cn(
          "flex flex-col min-h-0 relative rounded-xl transition-all duration-200 ease-out",
          // 主树撑满父容器；外部区的树按内容高度，滚动交给外层
          fill ? "h-full" : "h-auto",
          // ring 跟着 border-radius 走，所以圆角加在容器上而不是环上；
          // 1px + 虚线比 2px 实心轻，拖过的时候不糊住整个列表
          fileDropActive
            ? "bg-primary/[0.04] ring-1 ring-dashed ring-primary/50"
            : "ring-1 ring-transparent"
        )}
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
        {/* px-1 / pt-1 给行留出余量：行本身是铺满这个滚动容器宽度的，
            任何画在 border box 外的东西（焦点描边、外投影）都会被 overflow 裁掉。
            嵌在别的滚动区里的树把 px-1 让给外层（scrollInset=false），
            否则这棵树会比主树多缩进 4px。 */}
        <div
          data-note-tree-scroll
          className={cn(
            // 撑满时它是唯一的滚动区（flex-1 + min-h-0）；
            // 按内容高度时不参与伸缩，高度就是内容高度，滚动交给外层
            fill ? "flex-1 min-h-0" : "flex-none",
            "overflow-y-auto pt-1 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
            // 左右内边距：主树自带；嵌在别的滚动区里的树不再自带
            scrollInset ? "px-1" : "px-0",
            dropTarget === "" &&
              dragRel &&
              "bg-primary/5 outline outline-2 outline-dashed outline-primary/40 -outline-offset-2"
          )}
          {...rootDropProps}
          onContextMenu={(e) =>
            // 行上的右键自己 stopPropagation 了，冒到这里的就是空白处
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

      {/* 右键菜单挂在滚动容器外面 —— 它是 fixed 定位，不能被侧栏的 overflow 裁掉 */}
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
          onRefresh={onRefresh ? () => onRefresh() : undefined}
        />
      )}
    </TooltipProvider>
  );
}

export default React.memo(NoteFileList);
