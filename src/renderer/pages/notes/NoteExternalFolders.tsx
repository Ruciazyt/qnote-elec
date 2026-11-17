import React, { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  ExternalLink,
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
} from "../../../shared/notes/noteTypes";
import NoteFileList from "./NoteFileList";
import { cn } from "@/lib/utils";

type FileNode = Extract<NoteTreeNode, { kind: "file" }>;

interface ExternalUiState {
  currentFolder: string;
  renamingRel: string | null;
  renameValue: string;
  renaming: boolean;
}

const EMPTY_UI_STATE: ExternalUiState = {
  currentFolder: "",
  renamingRel: null,
  renameValue: "",
  renaming: false,
};

interface NoteExternalFoldersProps {
  folders: ExternalFolder[];
  trees: Record<string, NoteTreeNode[]>;
  loadingIds: Set<string>;
  onToggleFolder: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
  onOpenFile: (folder: ExternalFolder, node: FileNode) => void;
  onRevealInFolder?: (folder: ExternalFolder, node: NoteTreeNode) => void;
  onOpenFolder?: (folder: ExternalFolder) => void;
  onDelete: (folder: ExternalFolder, node: NoteTreeNode) => void;
  onRenameConfirm: (folder: ExternalFolder, node: NoteTreeNode, newName: string) => void;
  onCreateFolder: (folder: ExternalFolder, targetRel: string) => void;
  onCreateFile: (folder: ExternalFolder, type: NoteType, targetRel: string) => void;
  onMove: (folder: ExternalFolder, fromRel: string, toFolderRel: string) => void;
  onImportFiles: (folder: ExternalFolder, paths: string[]) => void;
  activeFolderId: string | null;
  activeRelPath: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function NoteExternalFolders({
  folders,
  trees,
  loadingIds,
  onToggleFolder,
  onAdd,
  onRemove,
  onRefresh,
  onOpenFile,
  onRevealInFolder,
  onOpenFolder,
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [uiState, setUiState] = useState<Record<string, ExternalUiState>>({});

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

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onToggleFolder(id);
  };

  const uiOf = useCallback(
    (id: string): ExternalUiState => uiState[id] ?? EMPTY_UI_STATE,
    [uiState]
  );

  const patchUi = useCallback((id: string, patch: Partial<ExternalUiState>) => {
    setUiState((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_UI_STATE), ...patch },
    }));
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      {}
      <div className="flex flex-col min-h-0 flex-1">
        {
}
        <div
          className="flex items-center gap-1 h-7 pr-1.5 flex-shrink-0"
          style={{ paddingLeft: 10 }}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "展开外部文件夹" : "收起外部文件夹"}
            aria-expanded={!collapsed}
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

        {
}
        {contentMounted && (
          <div
            className={cn(
              "flex-1 min-h-0 overflow-y-auto px-1 pb-1",
              collapsed
                ? "opacity-0 invisible pointer-events-none"
                : "opacity-100 visible"
            )}
            style={{
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
                      {
}
                      <div className="w-[46px] flex justify-end flex-shrink-0">
                        {
}
                        {onOpenFolder && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenFolder(folder);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            aria-label={`在文件管理器中打开 ${folder.name}`}
                            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-primary hover:bg-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
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
                            onRevealInFolder={
                              onRevealInFolder
                                ? (node) => onRevealInFolder(folder, node)
                                : undefined
                            }
                            onPickFolder={(rel) => patchUi(folder.id, { currentFolder: rel })}
                            onDelete={(node) => onDelete(folder, node)}
                            onRenameStart={(node) =>
                              patchUi(folder.id, {
                                renamingRel: node.relPath,
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
                            fill={false}
                            scrollInset={false}
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
