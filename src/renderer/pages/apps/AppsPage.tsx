import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CircleAlert,
  FileCode2,
  FolderPlus,
  Package,
  Plus,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/ui/use-toast";
import { useRouteActive } from "@/hooks/system/useRouteActive";
import { useCollapsedState } from "@/hooks/panel/useCollapsedState";
import { cn } from "@/lib/utils";
import { ResizableSidebar } from "@/components/panel/ResizableSidebar";
import { AppPreviewPane } from "@/pages/apps/AppPreviewPane";
import { AppLogConsole } from "@/pages/apps/AppLogConsole";
import { AppProjectList } from "@/pages/apps/AppProjectList";
import { AppProjectHeader } from "@/pages/apps/AppProjectHeader";
import { ManifestDialog, type ManifestDraft, type ManifestPayload } from "@/pages/apps/ManifestDialog";
import { RemoveProjectDialog } from "@/pages/apps/RemoveProjectDialog";
import { SpecDialog } from "@/pages/apps/SpecDialog";
import { PublishedAppMarket } from "@/pages/apps/PublishedAppMarket";
import {
  normalizeManifestPreview,
  previewAddressOf,
  previewToDraftText,
} from "@shared/apps/preview";
import type {
  AppLogLine,
  AppProject,
  AppRuntimeState,
} from "@shared/apps/appTypes";
import type { CloudBackend } from "@shared/cloud/cloudTypes";


const LOG_COLLAPSED_KEY = "qnote-apps-log-collapsed";

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
      preview: previewToDraftText(raw.preview),
    };
  } catch {
    return empty;
  }
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export default function AppsPage() {
  const { toast } = useToast();
  const isRouteActive = useRouteActive("/apps");

  const [projects, setProjects] = useState<AppProject[]>([]);
  const [runtime, setRuntime] = useState<Record<number, AppRuntimeState>>({});
  const [logs, setLogs] = useState<Record<number, AppLogLine[]>>({});
  const [previewAddresses, setPreviewAddresses] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [manifestOpen, setManifestOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ path: string; name: string } | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [cloudBackend, setCloudBackend] = useState<CloudBackend>("local");

  const [logCollapsed, setLogCollapsed] = useCollapsedState(LOG_COLLAPSED_KEY, false);

  const filteredProjects = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) || p.path.toLowerCase().includes(kw)
    );
  }, [projects, keyword]);

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

  useEffect(() => {
    if (!isRouteActive) return;
    let alive = true;
    void (async () => {
      try {
        const config = await window.electron.cloudGetConfig();
        if (alive) setCloudBackend(config.backend);
      } catch (err) {
        console.error("读取云端配置失败", err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isRouteActive]);

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

  useEffect(() => {
    setRemoveOpen(false);
  }, [selectedId]);

  useEffect(() => {
    const off = window.electron.onDialogMessage((message) => {
      if (message.action === "published") {
        toast({ title: "已发布", description: String(message.payload?.name ?? "") });
        return;
      }
      if (message.action !== "confirm") return;

      const projectId = Number(message.payload?.projectId ?? 0);
      const manifestHash = String(message.payload?.manifestHash ?? "");
      if (!projectId || !manifestHash) return;

      void (async () => {
        const res = await window.electron.appStart(projectId, manifestHash);
        if (res.needsConfirmation) {
          toast({
            title: "启动失败",
            description: "清单已经变了，请重新确认",
            variant: "destructive",
          });
          return;
        }
        if (!res.ok) {
          toast({ title: "启动失败", description: res.error, variant: "destructive" });
        }
      })();
    });
    return off;
  }, [toast]);


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
    async (project: AppProject, confirmedManifestHash?: string) => {
      const res = await window.electron.appStart(project.id, confirmedManifestHash);
      if (res.needsConfirmation) {
        const opened = await window.electron.dialogOpen({
          type: "start-confirm",
          payload: res.needsConfirmation as unknown as Record<string, unknown>,
        });
        if (!opened?.ok) {
          toast({
            title: "启动失败",
            description: opened?.error ?? "打不开确认窗口",
            variant: "destructive",
          });
        }
        return;
      }
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

  const handleMarketImported = useCallback(
    async (project: AppProject) => {
      setMarketOpen(false);
      await reload();
      setSelectedId(project.id);
    },
    [reload]
  );

  const handlePublish = useCallback(async () => {
    if (!selected) return;
    const opened = await window.electron.dialogOpen({
      type: "publish",
      payload: {
        name: selected.name,
        description: selected.description,
        manifest: normalizeManifestPreview(selected.manifestText ?? ""),
        projectId: selected.id,
      },
    });
    if (!opened?.ok) {
      toast({
        title: "发布失败",
        description: opened?.error ?? "打不开发布窗口",
        variant: "destructive",
      });
    }
  }, [selected, toast]);

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

  const handlePreviewUrlLoaded = useCallback((projectId: number, address: string) => {
    setPreviewAddresses((prev) => ({ ...prev, [projectId]: address }));
  }, []);


  const selectedRuntime = selectedId !== null ? runtime[selectedId] : undefined;
  const selectedLogs = selectedId !== null ? (logs[selectedId] ?? []) : [];

  const previewAddress = useMemo(() => {
    if (!selected) return undefined;
    const loaded = selectedId !== null ? previewAddresses[selectedId] : undefined;
    if (loaded) return loaded;
    if (selected.preview) return previewAddressOf(selected.preview);
    return undefined;
  }, [selected, selectedId, previewAddresses]);

  const manifestDraft = useMemo(
    () => (selected ? readManifestDraft(selected) : undefined),
    [selected]
  );

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
      {}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 flex-shrink-0">
        <Boxes className="h-4 w-4 text-muted-foreground/70" />
        <span className="text-sm font-medium">应用管理</span>

        <Button
          type="button"
          variant={marketOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs btn-hover ml-1"
          onClick={() => setMarketOpen((v) => !v)}
          aria-pressed={marketOpen}
          title="浏览别人发布的应用"
        >
          <Package className="h-3.5 w-3.5 mr-1" />
          应用市场
        </Button>

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

      {}
      <div className="flex-1 min-h-0 flex">
        {
}
        <ResizableSidebar
          storageKey="qnote-apps-list"
          defaultWidth={320}
          minWidth={240}
          maxWidth={520}
          minContentWidth={420}
          side="left"
          title={
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">项目</span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
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

        {}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          {marketOpen ? (
            <PublishedAppMarket
              backend={cloudBackend}
              onImported={(project) => void handleMarketImported(project)}
            />
          ) : !selected ? (
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
              {}
              <AppProjectHeader
                project={selected}
                runtime={selectedRuntime}
                previewUrl={previewAddress}
                onPublish={() => void handlePublish()}
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

              {}
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

              {}
              <AppPreviewPane
                project={selected}
                active={isRouteActive}
                suspended={manifestOpen || specOpen || removeOpen}
                onUrlLoaded={handlePreviewUrlLoaded}
                onError={(message) =>
                  toast({ title: "预览加载失败", description: message, variant: "destructive" })
                }
                className="flex-1"
              />

              {}
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

      {}
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

      {}
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
