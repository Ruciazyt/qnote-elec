import { useState, useEffect, useCallback, useRef } from "react";
import { useCollapsedState } from "@/hooks/useCollapsedState";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Progress } from "../ui/progress";
import { ChevronLeft, ChevronRight, Plus, Trash2, Edit, FileText, ListChecks } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  /* 收起 / 展开方向标记 —— 只为挑过渡时长用：
     退场比入场快一档（收起 150ms、展开 220ms），与通用面板件
     ResizableSidebar 同一套（docs/UI-AUDIT-2026-11-05.md P1-3）。
     两个状态在同一次事件里一起改，所以时长和方向永远对得上：
     点「收起」→ collapsing=true → duration-150；点「展开」→ collapsing=false
     → duration-[220ms]。 */
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
  // 删除目标的名字在「打开确认框那一刻」存下来。
  // 不能等到确认删除后再去列表里反查 —— 列表这时已经刷新，目标可能已经不在里面了。
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
    <TooltipProvider delayDuration={300}>
      /* 折叠轨宽度走行内样式：轨道宽是共享常量（PANEL_COLLAPSED_WIDTH），
         写成 Tailwind 的 w-10 就把数字写死在类名里了 —— 改了共享常量，
         这一页不会跟着变（笔记页与应用页的通用面板件都走行内样式）。
         展开态用 w-64（256px），这一页不支持拖拽调宽，维持原状。

         过渡只走 transition-[width]，不写 transition-all：
         all 会把 box-shadow 一起带上，收起那一帧阴影从「无」淡入、
         边框瞬间消失，分隔线的强度在过渡途中会变（走查 P1-2）。
         宽度不参与过渡，收起 / 展开的时长分两档（走查 P1-3）：
         退场 150ms、入场 220ms —— 与通用面板件 ResizableSidebar 同一套。

         motion-reduce:transition-none 是系统级「减少动态效果」的退路：
         开着的时候折叠/展开直接到位，不做宽度位移。对齐笔记页、
         快捷面板与通用面板件（2026-11-05 走查补齐）。 */
      <div
        className={cn(
          "bg-sidebar h-full flex flex-col transition-[width] ease-out motion-reduce:transition-none",
          collapsing ? "duration-150" : "duration-[220ms]",
          // 展开态的边界线是 1px 语义边框（border-border/60，不分强度档）。
          // 折叠态换用下面那条等色 inset 阴影 —— 两者不能同时存在：
          // 边框会占掉内容盒，48px 轨的内容盒只剩 47px，
          // 折叠按钮就不左右对称（左边 8px、右边只剩 7px）。
          sidebarCollapsed ? null : "border-r border-border/60",
          !sidebarCollapsed && "w-64"
        )}
        style={{
          width: sidebarCollapsed ? PANEL_COLLAPSED_WIDTH : undefined,
          // 折叠态的分隔线用 inset 阴影画，不占内容盒：
          // 颜色与展开态的 border-border/60 完全等价，两态切换时线的位置不动。
          ...(sidebarCollapsed
            ? { boxShadow: "inset -1px 0 0 0 hsl(var(--border) / 0.6)" }
            : null),
        }}>
        {/* 头部行 —— 与通用面板件（panel/layout.ts）同一套几何。

            内边距走行内样式（PANEL_COLLAPSED_BUTTON_INSET / PANEL_HEADER_PADDING_X），
            不用 Tailwind 的 px-/pl- 类：类名里的数字是写死的，跟共享常量各走各的。

            两态共用同一个左缘 8px（两个常量取值相同）：

            - 折叠态：8 + 32(按钮) + 8 = 48 = 折叠轨宽
              → 按钮落在轨道正中，左右各留 8px；focus 描边向外扩 1px 之后
              还剩 7px 余量，四边完整可见，不会被轨道边界裁掉。
            - 展开态：头部左内边距同样是 8px
              → 切换时按钮的 x 一动不动，只有面板宽度在变，零横向位移。

            overflow-hidden 是必须的：宽度过渡的那一帧轨道还是窄的，
            头部行内容却是展开态的宽度（按钮 + 标题 + 两个操作按钮），
            不裁的话它们会画到右侧主内容区上（实测溢出 99px，持续 200ms，
            见 docs/UI-GUIDELINES.md 第八节）。

            上下留白用 pt-2 pb-2（内边距），不能用 mt-2 mb-2（外边距）：
            overflow-hidden 的裁剪区是元素自己的盒（padding box）。
            用外边距时，行的盒正好从按钮上边缘开始（按钮 8..40，行 8..40），
            按钮 focus 描边画在盒外的那 1px（7 和 40）就被裁掉了 ——
            实测描边只剩左右两条竖边，上下两条横边整条消失。
            改成内边距后行是 0..48，按钮仍在 8..40（上下各留 8px不变），
            裁剪区罩得住整个描边，四边完整。
            这套 h-12 + pt-2 + pb-2 与通用面板件 ResizableSidebar 一致。 */}
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
                  // 收起与展开的过渡时长不同档，所以方向要一起记下来：
                  // collapsing=true 表示这次是收起（150ms），false 表示展开（220ms）。
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
            /* 面板头部标题统一 14px medium + text-foreground（跨域一致性口径，
               架构师定的）：全应用 bold 侧栏标题只有笔记页和题单页这两处 18px，
               其余 25+ 处都是 12–13px medium，18px 是孤例。
               页面主标题（h1）才用 text-xl font-bold。 */
            <h3 className="text-sm font-medium ml-2 text-left flex-1 text-foreground">题单</h3>
          )}
          {!sidebarCollapsed && (
            /* 两个操作按钮之间留 8px（gap-2）—— 同规格相邻图标按钮不能贴死，
               规范见 docs/UI-GUIDELINES.md 第三节。 */
            <div className="flex items-center gap-2 shrink-0">
              {/* 这两个按钮只有图标，必须带可读名称 —— 屏幕阅读器读不出
                  「FileText 是导入还是打开文件」，测试也只能按图标类名定位。
                  悬停提示走 ui/tooltip，不再用原生 title（走查 P1-4）：
                  原生 title 样式不可控、悬停约 1 秒才出现、键盘聚焦时不出现。 */}
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
          /* 内容列左内边距跟头部按钮同一条左缘（8px = PANEL_HEADER_PADDING_X）：
             头部按钮在 8px，卡片列也得在 8px，否则头部与内容列的左沿差 8px，
             面板看着是歪的（docs/UI-GUIDELINES.md 第六节）。 */
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
                  {/* 操作区默认是藏着的（opacity-0 + pointer-events-none），
                      鼠标悬停才显形。键盘 Tab 进来时没有悬停，
                      所以要补 focus-within 两项：容器挡住了指针，
                      聚焦后也得能看见、也得能点（走查 P0-3）。 */}
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

        {/* 新建题单对话框 */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>新建题单</DialogTitle>
              {/* 新建不是破坏性操作，但弹窗仍然要有描述节点：
                  只有真的渲染了 DialogDescription，Radix 才把它的 id 接进
                  aria-describedby，读屏打开那一瞬间才念得出这个弹窗是干嘛的
                  （docs/UI-GUIDELINES.md 第十节第六条）。 */}
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

        {/* 导入题单对话框 */}
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>导入题单</DialogTitle>
              {/* 同新建：弹窗要有描述节点，读屏打开时才知道这是什么。
                  正文只说明格式，不写操作后果 —— 导入不是破坏性操作。 */}
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
            setDeleteTargetName("");
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                删除题单
              </DialogTitle>
              {/* 正文必须由 DialogDescription 承载。
                  ui/dialog 不会自动生成描述节点，只有真的渲染了它，
                  Radix 才把它的 id 接上 aria-describedby；
                  正文放在普通 <p> 里 → 弹窗打开那一瞬间读屏只念得到标题，
                  「删的是哪一个题单」用户听不出来。

                  文案按 docs/UI-GUIDELINES.md 第十节的口径：
                  句式固定「确定要删除{对象类别}「{name}」吗？」——
                  动词、对象类别、目标名三段齐全，名字用「」包住且
                  font-medium text-foreground（能从正文里扫出来），
                  不可逆提示单独一行。名字逐字来自数据，不用「这个」「它」指代。 */}
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
