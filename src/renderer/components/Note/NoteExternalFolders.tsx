import React, { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  FolderPlus,
  HardDrive,
  RefreshCw,
  X,
  Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { NOTES_EXTERNAL_COLLAPSE_MS } from "./layout";
import {
  ExternalFolder,
  NoteTreeNode,
  NoteType,
} from "../../../shared/noteTypes";
import NoteFileList from "./NoteFileList";
import { cn } from "@/lib/utils";

type FileNode = Extract<NoteTreeNode, { kind: "file" }>;

/**
 * 外部文件夹区每个目录树的界面状态
 *
 * 「新建位置」和重命名的中间态都跟树绑定 —— 同一个树里只能有一个
 * 重命名中的条目，新建位置也只在这棵树里有意义。
 */
interface ExternalUiState {
  /** 新建位置（相对该外部文件夹的路径，"" 表示它的根） */
  currentFolder: string;
  /** 正在重命名的条目 relPath */
  renamingRel: string | null;
  /** 重命名输入框里的内容 */
  renameValue: string;
  /** 重命名落盘中 */
  renaming: boolean;
}

const EMPTY_UI_STATE: ExternalUiState = {
  currentFolder: "",
  renamingRel: null,
  renameValue: "",
  renaming: false,
};

interface NoteExternalFoldersProps {
  /** 已登记的外部文件夹 */
  folders: ExternalFolder[];
  /** 每个外部文件夹的目录树（id → 树），由父组件负责读 */
  trees: Record<string, NoteTreeNode[]>;
  /** 正在读树的外部文件夹 */
  loadingIds: Set<string>;
  /** 展开 / 收起某个外部文件夹（父组件在展开时去读树） */
  onToggleFolder: (id: string) => void;
  /** 弹系统目录选择框（由父进程调主进程） */
  onAdd: () => void;
  /** 从清单里移除（不动磁盘上的文件） */
  onRemove: (id: string) => void;
  /** 刷新已展开的外部文件夹 */
  onRefresh: () => void;
  /** 打开外部文件夹里的某个文件 */
  onOpenFile: (folder: ExternalFolder, node: FileNode) => void;
  /** 删除条目（磁盘上的真文件，界面负责确认） */
  onDelete: (folder: ExternalFolder, node: NoteTreeNode) => void;
  /** 重命名确认；newName 是用户在行内输入框里敲出来的名字（不含扩展名） */
  onRenameConfirm: (folder: ExternalFolder, node: NoteTreeNode, newName: string) => void;
  /** 在 targetRel 目录下新建文件夹 */
  onCreateFolder: (folder: ExternalFolder, targetRel: string) => void;
  /** 在 targetRel 目录下新建笔记文件 */
  onCreateFile: (folder: ExternalFolder, type: NoteType, targetRel: string) => void;
  /** 拖拽移动条目 */
  onMove: (folder: ExternalFolder, fromRel: string, toFolderRel: string) => void;
  /** 从系统拖入文件 */
  onImportFiles: (folder: ExternalFolder, paths: string[]) => void;
  /** 当前打开的文件属于哪个外部文件夹；null = 在笔记根目录里 */
  activeFolderId: string | null;
  /** 当前打开文件的相对路径（相对它所在的根目录） */
  activeRelPath: string | null;
  /**
   * 整块是否收起
   *
   * 状态由父组件（NotesPage）掌握 —— 它要靠这个状态给这一块定高度，
   * 收起时只留标题行，主树把空出来的高度全拿走。
   */
  collapsed: boolean;
  /** 收起 / 展开整块 */
  onToggleCollapsed: () => void;
}

/**
 * 外部文件夹面板 —— 笔记侧栏下半部分，可收起
 *
 * 用户从磁盘任意路径把文件夹添加进来，这里按树展示其中的笔记文件：
 * 只有应用能预览的类型（.md / .html / .pdf / 图片 / .excalidraw）才会出现，
 * 其余文件在主进程建树时就被过滤掉了。
 *
 * 目录树由父组件按需读取：展开某个文件夹时才去读它的树，没展开的不占 IO。
 *
 * 树本身直接用主树那套 NoteFileList —— 行尾的重命名 / 删除、右键菜单、
 * 拖拽移动、工具栏新建全都现成，两边行为一致，不用维护两套。
 *
 * 出口用 memo 包一层（理由同 NoteFileList）：拖分割线时父组件每帧重渲染，
 * 这块不该跟着每帧重建。
 */
function NoteExternalFolders({
  folders,
  trees,
  loadingIds,
  onToggleFolder,
  onAdd,
  onRemove,
  onRefresh,
  onOpenFile,
  onDelete,
  onRenameConfirm,
  onCreateFolder,
  onCreateFile,
  onMove,
  onImportFiles,
  activeFolderId,
  activeRelPath,
  collapsed,
  onToggleCollapsed,
}: NoteExternalFoldersProps) {
  /** 展开了哪些外部文件夹 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** 每个外部文件夹的界面状态（新建位置 / 重命名中间态） */
  const [uiState, setUiState] = useState<Record<string, ExternalUiState>>({});

  /**
   * 内容是否还留在 DOM 里
   *
   * 收起时不能直接卸载 —— 那样是「瞬切」：高度在缩，文字却先一步没了。
   * 这里让它多活一帧退场时长（与高度过渡同长），退场才是「缩下去 + 淡出」。
   *
   * 展开时立刻挂上：内容先在位，随高度一起长出来。
   */
  const [contentMounted, setContentMounted] = useState(!collapsed);
  useEffect(() => {
    if (!collapsed) {
      setContentMounted(true);
      return;
    }
    const timer = window.setTimeout(
      () => setContentMounted(false),
      NOTES_EXTERNAL_COLLAPSE_MS
    );
    return () => window.clearTimeout(timer);
  }, [collapsed]);

  /** 展开 / 收起某个外部文件夹 */
  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onToggleFolder(id);
  };

  /** 读某个外部文件夹的界面状态（没有就按默认值） */
  const uiOf = useCallback(
    (id: string): ExternalUiState => uiState[id] ?? EMPTY_UI_STATE,
    [uiState]
  );

  /** 改某个外部文件夹的界面状态 */
  const patchUi = useCallback((id: string, patch: Partial<ExternalUiState>) => {
    setUiState((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_UI_STATE), ...patch },
    }));
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      {/* 整块撑满父容器 —— 父容器（NotesPage）按比例给它高度 */}
      <div className="flex flex-col min-h-0 flex-1">
        {/* 标题行：收起状态下也留着，"添加文件夹"的入口不能被藏掉。

            左边距 10px 是算出来的：容器自身 px-2（8px）+ 行内 10px = 18px，
            正好等于主树里 depth-0 那一行的左边线（px-2 8 + 滚动区 px-1 4 + 行内 6）。
            两块区域的标题与行落在同一条线上，才算「一套」。 */}
        <div
          className="flex items-center gap-1 h-7 pr-1.5 flex-shrink-0"
          style={{ paddingLeft: 10 }}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "展开外部文件夹" : "收起外部文件夹"}
            aria-expanded={!collapsed}
            // before:-inset-1 把点击热区撑到 22px（按钮本身只有 14px，
            // 好和主树的箭头对齐）—— 这是整块的开关，热区不能太小
            className="relative w-3.5 h-3.5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent flex-shrink-0 transition-colors duration-150 before:absolute before:-inset-1 before:content-['']"
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform duration-150",
                !collapsed && "rotate-90"
              )}
            />
          </button>
          <HardDrive className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground font-medium truncate">
            外部文件夹
          </span>
          {folders.length > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {folders.length}
            </span>
          )}
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onRefresh}
                aria-label="刷新外部文件夹"
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent flex-shrink-0 transition-colors duration-150"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">刷新已展开的文件夹</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onAdd}
                aria-label="添加现有文件夹"
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-accent flex-shrink-0 transition-colors duration-150"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">把磁盘上的文件夹添加进来</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* 收起时内容不立刻卸载：高度在缩，文字跟着淡出，动画才连贯。
            退场结束（NOTES_EXTERNAL_COLLAPSE_MS）后由上面的 effect 卸载。 */}
        {contentMounted && (
          <div
            className={cn(
              // 这一层是外部区自己的滚动区：px-1 与主树的滚动区同宽，
              // 里面的行（外部文件夹行 + 树）都按这条左边线排
              "flex-1 min-h-0 overflow-y-auto px-1 pb-1",
              // 收起态是「结构性隐藏」：invisible 让里面的按钮退出 Tab 序，
              // 光靠 opacity-0 的话键盘还能 Tab 到看不见的东西上
              collapsed
                ? "opacity-0 invisible pointer-events-none"
                : "opacity-100 visible"
            )}
            style={{
              // 淡出立刻开始，visibility 等淡完那一刻再切 ——
              // 不带这层延迟的话元素直接变 hidden，肉眼看到的是瞬切
              transition: collapsed
                ? `opacity ${NOTES_EXTERNAL_COLLAPSE_MS}ms ease, visibility 0s ${NOTES_EXTERNAL_COLLAPSE_MS}ms`
                : `opacity ${NOTES_EXTERNAL_COLLAPSE_MS}ms ease, visibility 0s 0ms`,
            }}
          >
            {folders.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-muted-foreground/60 leading-relaxed">
                还没有添加文件夹。点上面的 + 选择磁盘上的目录，
                其中的笔记文件会列在这里。
              </p>
            ) : (
              folders.map((folder) => {
                const isOpen = expanded.has(folder.id);
                const isLoading = loadingIds.has(folder.id);
                const tree = trees[folder.id];
                const ui = uiOf(folder.id);
                return (
                  <div key={folder.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleFolder(folder.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleFolder(folder.id);
                        }
                      }}
                      className="group flex items-center gap-1 h-7 pr-1.5 rounded-md cursor-pointer transition-colors duration-150 note-row hover:bg-accent"
                      // 行内左边距 6px —— 与主树里 depth-0 的文件夹行完全一致；
                      // 外层滚动区已经带 px-1，两边加起来是同一条左边线
                      style={{ paddingLeft: 6 }}
                      title={folder.path}
                    >
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={isOpen ? "折叠" : "展开"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFolder(folder.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleFolder(folder.id);
                          }
                        }}
                        className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/70 hover:text-foreground flex-shrink-0 rounded"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 transition-transform duration-150",
                            isOpen && "rotate-90"
                          )}
                        />
                      </span>
                      {isLoading ? (
                        <Loader2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 animate-spin" />
                      ) : isOpen ? (
                        <FolderOpenIcon className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      ) : (
                        <FolderIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 truncate text-xs">{folder.name}</span>
                      {/* 右侧固定槽位与主树同宽（w-[46px]）：
                          主树里这个槽位放时间/子项数与行尾按钮，
                          宽度一样，两边的行才不会在右侧错开 */}
                      <div className="w-[46px] flex justify-end flex-shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemove(folder.id);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label={`移除 ${folder.name}`}
                          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div>
                        {isLoading && (
                          // pl-[18px]：与下面树里 depth-1 那一行的箭头对齐
                          <p className="text-[11px] text-muted-foreground/50 py-1 pl-[18px]">
                            正在读取…
                          </p>
                        )}
                        {!isLoading && tree && tree.length === 0 && (
                          <p className="text-[11px] text-muted-foreground/50 py-1 pl-[18px]">
                            没有可预览的文件
                          </p>
                        )}
                        {tree && (
                          <NoteFileList
                            nodes={tree}
                            activeRelPath={
                              activeFolderId === folder.id ? activeRelPath : null
                            }
                            currentFolder={ui.currentFolder}
                            renamingRel={ui.renamingRel}
                            renameValue={ui.renameValue}
                            renaming={ui.renaming}
                            onOpen={(node) => onOpenFile(folder, node)}
                            onPickFolder={(rel) => patchUi(folder.id, { currentFolder: rel })}
                            onDelete={(node) => onDelete(folder, node)}
                            onRenameStart={(node) =>
                              patchUi(folder.id, {
                                renamingRel: node.relPath,
                                // 文件夹不显示扩展名，文件要去掉扩展名
                                renameValue:
                                  node.kind === "folder"
                                    ? node.name
                                    : node.name.replace(/\.[^.]+$/, ""),
                              })
                            }
                            onRenameChange={(value) => patchUi(folder.id, { renameValue: value })}
                            onRenameConfirm={(node) => {
                              const typed = ui.renameValue.trim();
                              patchUi(folder.id, { renamingRel: null, renameValue: "" });
                              if (!typed) return;
                              onRenameConfirm(folder, node, typed);
                            }}
                            onRenameCancel={() =>
                              patchUi(folder.id, { renamingRel: null, renameValue: "" })
                            }
                            onCreateFolder={(target) => onCreateFolder(folder, target)}
                            onCreateFile={(type, target) => onCreateFile(folder, type, target)}
                            onMove={(from, to) => onMove(folder, from, to)}
                            onImportFiles={(paths) => onImportFiles(folder, paths)}
                            canCreateFile
                            createTargetFolder={ui.currentFolder}
                            // 按内容高度：外部区自己就是滚动区，树再撑满会变成套娃滚动
                            fill={false}
                            // 左右内边距让给外层滚动区 —— 这棵树嵌在里面，
                            // 再自带一层 px-1 就比主树多缩进 4px
                            scrollInset={false}
                            // 整棵树缩进一级，挂在「外部文件夹」那一行下面
                            depthOffset={1}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default React.memo(NoteExternalFolders);
