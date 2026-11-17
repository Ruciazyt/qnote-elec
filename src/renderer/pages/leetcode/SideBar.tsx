import { useState, useEffect, useCallback, useRef } from "react";
import { useCollapsedState } from "@/hooks/panel/useCollapsedState";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import { ChevronLeft, ChevronRight, Plus, Trash2, Edit, FileText, ListChecks } from "lucide-react";
import { useToast } from "@/hooks/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_WIDTH,
  PANEL_HEADER_PADDING_X,
} from "@/components/panel/layout";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Collection {
  id: number;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

interface SideBarProps {
  onSelectCollection: (id: number | null) => void;
  selectedCollectionId: number | null;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    electron: any;
  }
}

export default function Sidebar({ onSelectCollection, selectedCollectionId }: SideBarProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useCollapsedState(
  "leetcode-sidebar-collapsed",
  true
);
  const [collapsing, setCollapsing] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionSummary, setNewCollectionSummary] = useState("");
  const [creating, setCreating] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState("");
  const [importProgress, setImportProgress] = useState<{
    stage: "parsing" | "fetching" | "creating";
    progress: number;
    total: number;
    current?: string;
  } | null>(null);
  const { toast } = useToast();
  const progressCallbackRef = useRef<((event: unknown, data: unknown) => void) | null>(null);

  const loadCollections = useCallback(async () => {
    try {
      const data = await window.electron.getLeetcodeCollections();
      setCollections(data || []);
    } catch {
      toast({
        title: "加载失败",
        description: "无法加载题单列表",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    const handleProgress = (_: unknown, data: unknown) => {
      setImportProgress(
        data as {
          stage: "parsing" | "fetching" | "creating";
          progress: number;
          total: number;
          current?: string | undefined;
        } | null
      );
    };

    if (window.electron.onImportProgress) {
      window.electron.onImportProgress(handleProgress);
      progressCallbackRef.current = handleProgress;
    }

    return () => {
      if (progressCallbackRef.current && window.electron.removeImportProgress) {
        window.electron.removeImportProgress(progressCallbackRef.current);
      }
    };
  }, []);

  const handleDelete = async (id: number, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTargetId(id);
    setDeleteTargetName(name);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (deleteTargetId === null) return;
    const id = deleteTargetId;
    setShowDeleteDialog(false);
    setDeleteTargetId(null);
    setDeleteTargetName("");

    try {
      const success = await window.electron.deleteLeetcodeCollection(id);
      if (success) {
        toast({
          title: "删除成功",
          description: "题单已删除",
        });
        void loadCollections();
        if (selectedCollectionId === id) {
          onSelectCollection(null);
        }
      } else {
        toast({
          title: "删除失败",
          description: "删除题单时出错",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "删除失败",
        description: "删除题单时出错",
        variant: "destructive",
      });
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) {
      toast({
        title: "创建失败",
        description: "题单名称不能为空",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const saved = await window.electron.saveLeetcodeCollection({
        name: newCollectionName.trim(),
        summary: newCollectionSummary.trim(),
        problems: [],
      });

      if (saved) {
        toast({
          title: "创建成功",
          description: "题单已创建",
        });
        setShowCreateDialog(false);
        setNewCollectionName("");
        setNewCollectionSummary("");
        void loadCollections();
        if (saved.id) {
          onSelectCollection(saved.id);
        }
      } else {
        toast({
          title: "创建失败",
          description: "创建题单时出错",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "创建失败",
        description: "创建题单时出错",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleImportCollection = async () => {
    if (!importText.trim()) {
      toast({
        title: "导入失败",
        description: "请输入要导入的内容",
        variant: "destructive",
      });
      return;
    }

    setImporting(true);
    setImportProgress({ stage: "parsing", progress: 0, total: 100, current: "准备开始..." });
    try {
      const result = await window.electron.importLeetcodeCollection(importText.trim());

      if (result.success) {
        const successCount = result.successCount || result.collections?.length || 0;
        const failCount = result.failCount || 0;

        if (successCount > 0) {
          let description =
            result.message ||
            `成功导入 ${successCount} 个题单${failCount > 0 ? "，失败 " + failCount + " 个" : ""}`;
          if (result.errors) {
            description += `\n\n${result.errors}`;
          }

          toast({
            title: "导入成功",
            description: description,
            duration: failCount > 0 || result.errors ? 10000 : 5000,
          });
          setShowImportDialog(false);
          setImportText("");
          setImportProgress(null);
          void loadCollections();

          if (result.collections && result.collections.length === 1 && result.collections[0].id) {
            onSelectCollection(result.collections[0].id);
          }
        } else {
          toast({
            title: "导入失败",
            description: result.errors || result.error || "所有题单导入失败",
            variant: "destructive",
            duration: 10000,
          });
        }
      } else {
        toast({
          title: "导入失败",
          description: result.error || "导入题单时出错",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "导入失败",
        description: error?.["message"] || "导入题单时出错",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      {
}
      <div
        className={cn(
          "bg-sidebar h-full flex flex-col transition-[width] ease-out motion-reduce:transition-none",
          collapsing ? "duration-150" : "duration-panel",
          sidebarCollapsed ? null : "border-r border-border/60",
          !sidebarCollapsed && "w-64"
        )}
        style={{
          width: sidebarCollapsed ? PANEL_COLLAPSED_WIDTH : undefined,
          ...(sidebarCollapsed
            ? { boxShadow: "inset -1px 0 0 0 hsl(var(--border) / 0.6)" }
            : null),
        }}>
        {
}
        <div
          className="flex items-center pt-2 pb-2 flex-shrink-0 overflow-hidden"
          style={{
            paddingLeft: PANEL_COLLAPSED_BUTTON_INSET,
            paddingRight: sidebarCollapsed ? 0 : PANEL_HEADER_PADDING_X,
          }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  const next = !sidebarCollapsed;
                  setCollapsing(next);
                  setSidebarCollapsed(next);
                }}
                aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
                aria-expanded={!sidebarCollapsed}
                className="leetcode-sidebar-btn h-8 w-8 shrink-0">
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              <p className="text-xs">{sidebarCollapsed ? "展开侧栏" : "收起侧栏"}</p>
            </TooltipContent>
          </Tooltip>
          {!sidebarCollapsed && (
            <h3 className="text-sm font-medium ml-2 text-left flex-1 text-foreground">题单</h3>
          )}
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 shrink-0">
              {
}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowImportDialog(true)}
                    aria-label="导入题单"
                    className="leetcode-sidebar-btn h-8 w-8 shrink-0">
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  <p className="text-xs">导入题单</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowCreateDialog(true)}
                    aria-label="新建题单"
                    className="leetcode-sidebar-btn h-8 w-8 shrink-0">
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  <p className="text-xs">新建题单</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
        {!sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto px-2 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <div className="space-y-2">
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  className={`bg-card rounded-lg shadow-sm border p-3 cursor-pointer flex items-center justify-between group leetcode-collection-card transition-all duration-200 ${
                    selectedCollectionId === collection.id
                      ? "selected border-sidebar-primary shadow-md ring-2 ring-sidebar-primary/30"
                      : "border-sidebar-border hover:border-sidebar-border"
                  }`}
                  onClick={() => onSelectCollection(collection.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`打开题单：${collection.name}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectCollection(collection.id);
                    }
                  }}>
                  <div className="flex-1 min-w-0 pr-2">
                    <div
                      className={`font-medium truncate ${
                        selectedCollectionId === collection.id ? "text-sidebar-primary" : "text-sidebar-foreground"
                      }`}>
                      {collection.name}
                    </div>
                    {collection.summary && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {collection.summary}
                      </div>
                    )}
                  </div>
                  {
}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 ease-out flex-shrink-0 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`编辑题单：${collection.name}`}
                          className="h-7 w-7 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCollection(collection.id);
                          }}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" sideOffset={4}>
                        <p className="text-xs">编辑题单</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`删除题单：${collection.name}`}
                          className="h-7 w-7 hover:bg-destructive/10 text-destructive hover:text-destructive"
                          onClick={(e) => handleDelete(collection.id, collection.name, e)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" sideOffset={4}>
                        <p className="text-xs">删除题单</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
              {collections.length === 0 && (
                <div className="text-center py-10 leetcode-empty-state animate-fade-in-stagger">
                  <div className="relative w-12 h-12 mx-auto mb-3 rounded-lg bg-primary/[0.06] border border-primary/15 flex items-center justify-center icon-glow-ring animate-float">
                    <ListChecks className="h-5 w-5 text-primary/50" />
                  </div>
                  <p className="text-sm text-muted-foreground/70 mb-1">暂无题单</p>
                  <p className="text-xs text-muted-foreground">点击 <Plus className="inline h-3 w-3 -mt-0.5" /> 按钮创建</p>
                </div>
              )}
            </div>
          </div>
        )}

        {}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>新建题单</DialogTitle>
              {
}
              <DialogDescription>
                给这份题单起个名字，它会出现在左侧题单列表里。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="leetcode-collection-name" className="text-sm font-medium mb-2 block">题单名称</label>
                <Input
                  id="leetcode-collection-name"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="请输入题单名称"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleCreateCollection();
                    }
                  }}
                />
              </div>
              <div>
                <label htmlFor="leetcode-collection-summary" className="text-sm font-medium mb-2 block">题单总结（可选）</label>
                <Textarea
                  id="leetcode-collection-summary"
                  value={newCollectionSummary}
                  onChange={(e) => setNewCollectionSummary(e.target.value)}
                  placeholder="请输入题单总结"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewCollectionName("");
                  setNewCollectionSummary("");
                }}>
                取消
              </Button>
              <Button onClick={handleCreateCollection} disabled={creating}>
                {creating ? "创建中..." : "创建"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {}
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>导入题单</DialogTitle>
              {
}
              <DialogDescription>
                粘贴题目名称、编号或 LeetCode 链接，支持一次导入多份题单。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="leetcode-import-text" className="text-sm font-medium mb-2 block">
                  导入内容（支持题目名称、编号、URL等，可包含多个题单）
                </label>
                <Textarea
                  id="leetcode-import-text"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="例如：&#10;题单1：动态规划专题&#10;1. 两数之和&#10;2. 三数之和&#10;&#10;题单2：数组专题&#10;3. 最长回文子串&#10;或直接粘贴题目列表..."
                  rows={10}
                  className="font-mono text-sm"
                  disabled={importing}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  提示：AI会自动解析题单名称和题目列表，并获取题目链接。支持批量导入多个题单。
                </p>
              </div>

              {}
              {importProgress && importing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">
                      {importProgress.stage === "parsing" && "解析中..."}
                      {importProgress.stage === "fetching" && "获取链接中..."}
                      {importProgress.stage === "creating" && "创建题单中..."}
                    </span>
                    <span className="text-muted-foreground">
                      {Math.min(
                        Math.floor((importProgress.progress / importProgress.total) * 100),
                        100
                      )}
                      %
                    </span>
                  </div>
                  <Progress
                    value={Math.min((importProgress.progress / importProgress.total) * 100, 100)}
                    className="h-2"
                  />
                  {importProgress.current && (
                    <p className="text-xs text-muted-foreground/90 truncate">{importProgress.current}</p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowImportDialog(false);
                  setImportText("");
                  setImportProgress(null);
                }}
                disabled={importing}>
                取消
              </Button>
              <Button onClick={handleImportCollection} disabled={importing || !importText.trim()}>
                {importing ? "导入中..." : "导入"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showDeleteDialog} onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowDeleteDialog(false);
            setDeleteTargetId(null);
            setDeleteTargetName("");
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                删除题单
              </DialogTitle>
              {
}
              <DialogDescription>
                确定要删除题单「<span className="font-medium text-foreground break-all">{deleteTargetName}</span>」吗？
                <br />
                <span className="text-destructive font-medium">此操作不可逆！</span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowDeleteDialog(false);
                setDeleteTargetId(null);
                setDeleteTargetName("");
              }}>
                取消
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                确定删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
