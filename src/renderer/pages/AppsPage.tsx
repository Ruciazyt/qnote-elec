import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CircleAlert,
  FileCode2,
  FolderPlus,
  Plus,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRouteActive } from "@/hooks/useRouteActive";
import { useCollapsedState } from "@/hooks/useCollapsedState";
import { cn } from "@/lib/utils";
import { ResizableSidebar } from "@/components/panel/ResizableSidebar";
import { AppPreviewPane } from "@/components/apps/AppPreviewPane";
import { AppLogConsole } from "@/components/apps/AppLogConsole";
import { AppProjectList } from "@/components/apps/AppProjectList";
import { AppProjectHeader } from "@/components/apps/AppProjectHeader";
import { ManifestDialog, type ManifestDraft, type ManifestPayload } from "@/components/apps/ManifestDialog";
import { RemoveProjectDialog } from "@/components/apps/RemoveProjectDialog";
import { SpecDialog } from "@/components/apps/SpecDialog";
import type {
  AppLogLine,
  AppProject,
  AppRuntimeState,
} from "@shared/appTypes";

/**
 * 应用管理页
 *
 * 按文件夹管理 vibe coding 产物：**直接导入项目文件夹**，
 * 文件夹里带一份 qnote.json 就合规，可启动、可预览。
 *
 * 项目之间没有父子关系 —— 导入的就是项目本身，
 * 因此项目可以散落在任意不同的目录下。
 *
 * 进程与预览都由主进程持有，渲染层只做展示与触发 —— 见 appHandlers.ts。
 */

/** 底部运行输出的折叠状态 */
const LOG_COLLAPSED_KEY = "qnote-apps-log-collapsed";

/**
 * 从清单原文还原出编辑框的初始值
 *
 * 不能直接用 project.command —— 那是主进程拼好的完整命令行（command + args），
 * 拿它回填会把参数塞进命令框里，再保存一次就变成了 `node server.js --port 3000`
 * 这种命令里带参数、args 又为空的样子。清单原文才是真相。
 */
function readManifestDraft(project: AppProject): Partial<ManifestDraft> {
  const empty: Partial<ManifestDraft> = {
    name: "",
    description: "",
    command: "",
    args: "",
    cwd: "",
    env: "",
    preview: "",
  };
  if (!project.manifestText) return empty;

  try {
    const raw = JSON.parse(project.manifestText) as Record<string, unknown>;
    const env =
      raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
        ? Object.entries(raw.env as Record<string, unknown>)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join("\n")
        : "";
    return {
      name: typeof raw.name === "string" ? raw.name : "",
      description: typeof raw.description === "string" ? raw.description : "",
      command: typeof raw.command === "string" ? raw.command : "",
      args: Array.isArray(raw.args) ? raw.args.map(String).join("\n") : "",
      cwd: typeof raw.cwd === "string" ? raw.cwd : "",
      env,
      preview: typeof raw.preview === "string" ? raw.preview : "",
    };
  } catch {
    return empty;
  }
}

/** 取路径末段的名字 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export default function AppsPage() {
  const { toast } = useToast();
  /** keep-alive 下页面切走不会卸载，原生视图的显隐靠这个标志 */
  const isRouteActive = useRouteActive("/apps");

  const [projects, setProjects] = useState<AppProject[]>([]);
  const [runtime, setRuntime] = useState<Record<number, AppRuntimeState>>({});
  const [logs, setLogs] = useState<Record<number, AppLogLine[]>>({});
  /** projectId → 当前预览的地址（主进程解析后的真实地址） */
  const [previewAddresses, setPreviewAddresses] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** 左侧列表的搜索词 —— 提到页面层，标题旁要显示「筛选中 / 总数」 */
  const [keyword, setKeyword] = useState("");
  const [manifestOpen, setManifestOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 正在补清单的项目 —— 导入不合规时先补齐再导入 */
  const [pendingImport, setPendingImport] = useState<{ path: string; name: string } | null>(null);
  /** 移除项目的确认框 */
  const [removeOpen, setRemoveOpen] = useState(false);

  const [logCollapsed, setLogCollapsed] = useCollapsedState(LOG_COLLAPSED_KEY, false);

  /**
   * 按名称与路径过滤 —— 名字和路径都是用户找项目时脑子里的索引
   */
  const filteredProjects = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) || p.path.toLowerCase().includes(kw)
    );
  }, [projects, keyword]);

  /** 侧栏标题旁的计数：搜索时显示「命中 / 总数」，否则显示总数 */
  const projectCountLabel = useMemo(
    () =>
      keyword.trim()
        ? `${filteredProjects.length} / ${projects.length}`
        : String(projects.length),
    [filteredProjects.length, projects.length, keyword]
  );

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId]
  );

  // ------------------------------------------------------------------
  // 数据加载
  // ------------------------------------------------------------------

  const reload = useCallback(async () => {
    try {
      const [ps, rs] = await Promise.all([
        window.electron.appListProjects(),
        window.electron.appRuntimeStates(),
      ]);
      setProjects(ps);
      setRuntime(Object.fromEntries(rs.map((r) => [r.projectId, r])));
    } catch (err) {
      console.error("读取应用管理数据失败", err);
    }
  }, []);

  /** 重新读一遍所有项目的清单 —— 用户改了 qnote.json 后刷新即生效 */
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const ps = await window.electron.appRefreshProjects();
      setProjects(ps);
    } catch (err) {
      console.error("刷新清单失败", err);
      toast({ title: "刷新失败", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 主进程广播
  useEffect(() => {
    const offProjects = window.electron.onAppProjectsChanged((next) => {
      setProjects(next);
    });
    const offRuntime = window.electron.onAppRuntimeChanged((state) => {
      setRuntime((prev) => ({ ...prev, [state.projectId]: state }));
    });
    const offLog = window.electron.onAppLog((line) => {
      setLogs((prev) => {
        const list = prev[line.projectId] ?? [];
        return { ...prev, [line.projectId]: [...list, line].slice(-400) };
      });
    });
    return () => {
      offProjects();
      offRuntime();
      offLog();
    };
  }, []);

  // 选中项目时把它的历史输出拉回来
  useEffect(() => {
    if (selectedId === null) return;
    void (async () => {
      try {
        const lines = await window.electron.appLogs(selectedId);
        setLogs((prev) => ({ ...prev, [selectedId]: lines }));
      } catch (err) {
        console.error("读取运行输出失败", err);
      }
    })();
  }, [selectedId]);

  // 切换项目时收起移除确认
  useEffect(() => {
    setRemoveOpen(false);
  }, [selectedId]);

  // ------------------------------------------------------------------
  // 操作
  // ------------------------------------------------------------------

  /**
   * 导入项目文件夹
   *
   * 合规就是「文件夹里有 qnote.json」。不合规时**不落库**，
   * 而是打开清单编辑器补一份 —— 补完自动导入，用户不用重来一遍。
   */
  const handleImport = useCallback(async () => {
    try {
      const picked = await window.electron.appPickProjectDir();
      if (!picked) return;

      const res = await window.electron.appImportProject(picked);
      if (res.ok && res.project) {
        await reload();
        setSelectedId(res.project.id);
        toast({ title: "已导入", description: res.project.name });
        return;
      }

      if (res.reason === "missing-manifest" || res.reason === "invalid-manifest") {
        setPendingImport({ path: picked, name: baseName(picked) });
        setManifestOpen(true);
        return;
      }

      toast({
        title: "导入失败",
        description: res.error ?? "该文件夹不符合规范",
        variant: "destructive",
      });
    } catch (err) {
      toast({ title: "导入失败", description: String(err), variant: "destructive" });
    }
  }, [reload, toast]);

  const handleStart = useCallback(
    async (project: AppProject) => {
      const res = await window.electron.appStart(project.id);
      if (!res.ok) {
        toast({ title: "启动失败", description: res.error, variant: "destructive" });
      }
    },
    [toast]
  );

  const handleStop = useCallback(
    async (project: AppProject) => {
      const res = await window.electron.appStop(project.id);
      if (!res.ok) {
        toast({ title: "停止失败", description: res.error, variant: "destructive" });
      }
    },
    [toast]
  );

  /**
   * 保存清单
   *
   * 两条来路：给已导入的项目改清单，或者给刚选的文件夹补一份（补完自动导入）。
   */
  const handleSaveManifest = useCallback(
    async (payload: ManifestPayload) => {
      const target = pendingImport?.path ?? selected?.path;
      if (!target) return;

      const res = await window.electron.appWriteManifest(target, payload);
      if (!res.ok) {
        toast({ title: "保存清单失败", description: res.error, variant: "destructive" });
        throw new Error(res.error ?? "保存失败");
      }

      if (pendingImport) {
        const imported = await window.electron.appImportProject(target);
        if (!imported.ok || !imported.project) {
          toast({
            title: "导入失败",
            description: imported.error ?? "该项目导入失败",
            variant: "destructive",
          });
          throw new Error(imported.error ?? "导入失败");
        }
        setPendingImport(null);
        await reload();
        setSelectedId(imported.project.id);
        toast({ title: "已导入", description: imported.project.name });
        return;
      }

      // 已导入的项目：重新读一遍清单，让界面立刻反映新配置
      await refresh();
      toast({ title: "清单已保存" });
    },
    [pendingImport, selected, reload, refresh, toast]
  );

  const handleRemove = useCallback(async () => {
    if (!selected) return;
    const res = await window.electron.appRemoveProject(selected.id);
    setRemoveOpen(false);
    if (!res.ok) {
      toast({ title: "移除失败", description: res.error, variant: "destructive" });
      return;
    }
    setSelectedId(null);
    await reload();
    toast({ title: "已移除项目", description: selected.name });
  }, [selected, reload, toast]);

  const handleClearLogs = useCallback(async () => {
    if (selectedId === null) return;
    await window.electron.appClearLogs(selectedId);
    setLogs((prev) => ({ ...prev, [selectedId]: [] }));
  }, [selectedId]);

  const handleOpenFolder = useCallback(
    async (path: string) => {
      const res = await window.electron.appOpenFolder(path);
      if (!res.ok) {
        toast({ title: "打开目录失败", description: res.error, variant: "destructive" });
      }
    },
    [toast]
  );

  /**
   * 复制预览地址
   *
   * 端口信息用户多半是要拿去用的（贴到浏览器、贴到别的工具里），
   * 所以给一个一键复制，比让人自己框选那一小段等宽字靠谱。
   */
  const handleCopyAddress = useCallback(
    async (address: string) => {
      try {
        await navigator.clipboard.writeText(address);
        toast({ title: "地址已复制", description: address });
      } catch (err) {
        toast({
          title: "复制失败",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  /** 预览载入后记下它的真实地址 —— 头部要显示「现在展示的页面地址」 */
  const handlePreviewUrlLoaded = useCallback((projectId: number, address: string) => {
    setPreviewAddresses((prev) => ({ ...prev, [projectId]: address }));
  }, []);

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------

  const selectedRuntime = selectedId !== null ? runtime[selectedId] : undefined;
  const isRunning =
    selectedRuntime?.status === "running" || selectedRuntime?.status === "starting";
  const selectedLogs = selectedId !== null ? (logs[selectedId] ?? []) : [];

  /**
   * 头部要显示的预览地址
   *
   * 优先用主进程解析出来的真实地址；还没载入完时先用清单里的 http 地址顶上，
   * 免得刚点开项目、地址那一格是空的。
   */
  const previewAddress = useMemo(() => {
    if (!selected) return undefined;
    const loaded = selectedId !== null ? previewAddresses[selectedId] : undefined;
    if (loaded) return loaded;
    if (selected.preview && /^https?:\/\//i.test(selected.preview)) return selected.preview;
    return undefined;
  }, [selected, selectedId, previewAddresses]);

  /** 编辑框的初始值 —— 跟着清单原文走，别跟着拼好的命令行走 */
  const manifestDraft = useMemo(
    () => (selected ? readManifestDraft(selected) : undefined),
    [selected]
  );

  /** 清单对话框的目标路径与标题：导入补清单 vs 编辑已有清单 */
  const manifestTarget = useMemo(() => {
    if (pendingImport) {
      return {
        path: pendingImport.path,
        initial: { name: pendingImport.name } as Partial<ManifestDraft>,
        title: "补一份 qnote.json",
      };
    }
    if (selected) {
      return {
        path: selected.path,
        initial: manifestDraft,
        title: "项目清单 qnote.json",
      };
    }
    return null;
  }, [pendingImport, selected, manifestDraft]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 flex-shrink-0">
        <Boxes className="h-4 w-4 text-muted-foreground/70" />
        <span className="text-sm font-medium">应用管理</span>

        <div className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs btn-hover"
          onClick={() => setSpecOpen(true)}>
          <ScrollText className="h-3.5 w-3.5 mr-1" />
          清单规范
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs btn-hover"
          disabled={busy}
          onClick={() => void refresh()}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1", busy && "animate-spin")} />
          刷新清单
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs btn-hover"
          onClick={() => void handleImport()}>
          <FolderPlus className="h-3.5 w-3.5 mr-1" />
          导入文件夹
        </Button>
      </div>

      {/* 主体 */}
      <div className="flex-1 min-h-0 flex">
        {/* 左：项目列表（可收起、可拖拽调宽）
            折叠按钮放在侧栏自己的头部里 —— 笔记页、题单页都是这个位置，
            收起后侧栏退化成一条按钮轨，按钮仍然够得着。 */}
        <ResizableSidebar
          storageKey="qnote-apps-list"
          defaultWidth={320}
          minWidth={240}
          maxWidth={520}
          minContentWidth={420}
          side="left"
          title={
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-[13px] font-medium text-foreground truncate">项目</span>
              <span className="text-[11px] text-muted-foreground/60 flex-shrink-0">
                {projectCountLabel}
              </span>
            </span>
          }>
          <AppProjectList
            projects={filteredProjects}
            keyword={keyword}
            onKeywordChange={setKeyword}
            runtime={runtime}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onImport={() => void handleImport()}
          />
        </ResizableSidebar>

        {/* 右：项目详情 */}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <FileCode2 className="h-9 w-9 text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground/70">
                {projects.length === 0 ? "还没有导入任何项目" : "从左侧选一个项目"}
              </p>
              <p className="text-xs text-muted-foreground/50 max-w-sm leading-relaxed">
                项目 = 一个文件夹 + 一份 qnote.json 清单。清单决定它怎么启动、预览哪个页面。
              </p>
              {projects.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs btn-hover"
                  onClick={() => void handleImport()}>
                  <FolderPlus className="h-3.5 w-3.5 mr-1" />
                  导入文件夹
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* 详情头部 */}
              <AppProjectHeader
                project={selected}
                runtime={selectedRuntime}
                previewUrl={previewAddress}
                onStart={() => void handleStart(selected)}
                onStop={() => void handleStop(selected)}
                onEditManifest={() => {
                  setPendingImport(null);
                  setManifestOpen(true);
                }}
                onOpenFolder={() => void handleOpenFolder(selected.path)}
                onRemove={() => setRemoveOpen(true)}
                onCopyAddress={(address) => void handleCopyAddress(address)}
              />

              {/* 未就绪时的提示条 */}
              {selected.status !== "ready" && (
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
                  <CircleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="text-amber-700 dark:text-amber-300 font-medium">
                      {selected.status === "missing-manifest"
                        ? "这个文件夹还不是一个可管理的项目"
                        : "qnote.json 解析失败"}
                    </p>
                    {selected.error && (
                      <p className="text-muted-foreground/80 leading-relaxed">{selected.error}</p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs btn-hover"
                      onClick={() => {
                        setPendingImport(null);
                        setManifestOpen(true);
                      }}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {selected.status === "missing-manifest" ? "生成 qnote.json" : "修正清单"}
                    </Button>
                  </div>
                </div>
              )}

              {/* 预览区 */}
              <AppPreviewPane
                project={selected}
                active={isRouteActive}
                /* 弹窗打开时把预览收起来 —— 原生视图盖在 DOM 之上，
                   不收的话对话框会被压在预览页面底下，点不动也看不见。 */
                suspended={manifestOpen || specOpen || removeOpen}
                onUrlLoaded={handlePreviewUrlLoaded}
                onError={(message) =>
                  toast({ title: "预览加载失败", description: message, variant: "destructive" })
                }
                className="flex-1"
              />

              {/* 运行输出（可收起，高度有过渡） */}
              <AppLogConsole
                lines={selectedLogs}
                onClear={() => void handleClearLogs()}
                collapsed={logCollapsed}
                onToggleCollapsed={() => setLogCollapsed((v) => !v)}
              />
            </>
          )}
        </section>
      </div>

      {/* 清单编辑 */}
      {manifestTarget && (
        <ManifestDialog
          key={manifestTarget.path}
          open={manifestOpen}
          projectPath={manifestTarget.path}
          title={manifestTarget.title}
          initial={manifestTarget.initial}
          onClose={() => {
            setManifestOpen(false);
            setPendingImport(null);
          }}
          onSave={handleSaveManifest}
        />
      )}

      <SpecDialog open={specOpen} onClose={() => setSpecOpen(false)} />

      {/* 移除确认 */}
      {selected && (
        <RemoveProjectDialog
          open={removeOpen}
          name={selected.name}
          path={selected.path}
          onClose={() => setRemoveOpen(false)}
          onConfirm={() => void handleRemove()}
        />
      )}
    </div>
  );
}
