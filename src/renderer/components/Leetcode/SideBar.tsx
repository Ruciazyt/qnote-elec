import { useState, useEffect, useCallback, useRef } from "react";
import { useCollapsedState } from "@/hooks/useCollapsedState";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Progress } from "../ui/progress";
import { ChevronLeft, ChevronRight, Plus, Trash2, Edit, FileText, ListChecks } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionSummary, setNewCollectionSummary] = useState("");
  const [creating, setCreating] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
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

  // 设置导入进度监听
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

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTargetId(id);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (deleteTargetId === null) return;
    const id = deleteTargetId;
    setShowDeleteDialog(false);
    setDeleteTargetId(null);

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
        // 创建成功后自动打开编辑
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
          // 构建描述信息，包含错误信息（如果有）
          let description =
            result.message ||
            `成功导入 ${successCount} 个题单${failCount > 0 ? `，失败 ${failCount} 个` : ""}`;
          if (result.errors) {
            description += `\n\n${result.errors}`;
          }

          toast({
            title: "导入成功",
            description: description,
            duration: failCount > 0 || result.errors ? 10000 : 5000, // 有错误时显示更长时间
          });
          setShowImportDialog(false);
          setImportText("");
          setImportProgress(null);
          void loadCollections();

          // 如果只有一个题单，自动打开编辑
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
    <div
      className={
        sidebarCollapsed
          ? "w-10 border-r border-sidebar-border bg-sidebar h-full flex flex-col items-center p-0 transition-all duration-200"
          : "w-64 border-r border-sidebar-border bg-sidebar h-full flex flex-col transition-all duration-200"
      }>
      <div className="flex items-center mb-2 mt-2 px-4 flex-shrink-0">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          className="leetcode-sidebar-btn">
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </Button>
        {!sidebarCollapsed && <h3 className="font-bold text-lg ml-2 text-left flex-1">题单</h3>}
        {!sidebarCollapsed && (
          <>
            <Button size="icon" variant="ghost" onClick={() => setShowImportDialog(true)} className="leetcode-sidebar-btn">
              <FileText />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setShowCreateDialog(true)} className="leetcode-sidebar-btn">
              <Plus />
            </Button>
          </>
        )}
      </div>
      {!sidebarCollapsed && (
        <div className="flex-1 overflow-y-auto px-4 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                  // 卡片内的编辑/删除按钮各自处理回车，这里只响应卡片本身获得焦点的情况
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
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 ease-out flex-shrink-0 pointer-events-none group-hover:pointer-events-auto">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCollection(collection.id);
                    }}>
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 hover:bg-destructive/10 text-destructive hover:text-destructive"
                    onClick={(e) => handleDelete(collection.id, e)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {collections.length === 0 && (
              <div className="text-center py-10 leetcode-empty-state animate-fade-in-stagger">
                <div className="relative w-12 h-12 mx-auto mb-3 rounded-lg bg-primary/[0.06] border border-primary/15 flex items-center justify-center icon-glow-ring animate-float">
                  <ListChecks className="h-5 w-5 text-primary/50" />
                </div>
                <p className="text-sm text-muted-foreground/70 mb-1">暂无题单</p>
                <p className="text-xs text-muted-foreground/60">点击 <Plus className="inline h-3 w-3 -mt-0.5" /> 按钮创建</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 新建题单对话框 */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建题单</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">题单名称</label>
              <Input
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
              <label className="text-sm font-medium mb-2 block">题单总结（可选）</label>
              <Textarea
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

      {/* 导入题单对话框 */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>导入题单</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                导入内容（支持题目名称、编号、URL等，可包含多个题单）
              </label>
              <Textarea
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

            {/* 进度条 */}
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
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              删除题单
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              确定要删除这个题单吗？
              <br />
              <span className="text-destructive font-medium">此操作不可逆！</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowDeleteDialog(false);
              setDeleteTargetId(null);
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
  );
}
