import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/ui/use-toast";
import { useRouteActive } from "@/hooks/system/useRouteActive";
import { useCollapsedState } from "@/hooks/panel/useCollapsedState";
import { cn } from "@/lib/utils";
import { ResizableSidebar } from "@/components/panel/ResizableSidebar";
import { PluginPreviewPane } from "@/pages/plugin/runtime/PluginPreviewPane";
import { PluginLogConsole } from "@/pages/plugin/runtime/PluginLogConsole";
import { PluginList } from "@/pages/plugin/runtime/PluginList";
import { PluginHeader } from "@/pages/plugin/runtime/PluginHeader";
import {
  PluginManifestDialog,
  type PluginManifestForm,
} from "@/pages/plugin/manifest/PluginManifestDialog";
import { RemovePluginDialog } from "@/pages/plugin/runtime/RemovePluginDialog";
import { PluginPermissionsPanel } from "@/pages/plugin/permissions/PluginPermissionsPanel";
import { PluginSettingsPanel } from "@/pages/plugin/runtime/PluginSettingsPanel";
import { PluginSpecDialog } from "@/pages/plugin/manifest/PluginSpecDialog";
import { PublishedPluginMarket } from "@/pages/plugin/market/PublishedPluginMarket";
import {
  normalizeManifestPreview,
  pluginPreviewAddress,
  previewToDraftText,
} from "@shared/plugin/manifest/pluginPreview";
import type {
  PluginLogLine,
  PluginManifestDraft,
  PluginRecord,
  PluginRuntimeState,
} from "@shared/plugin/manifest/pluginTypes";
import type { CloudBackend } from "@shared/cloud/cloudTypes";

const LOG_COLLAPSED_KEY = "qnote-plugins-log-collapsed";

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function defaultPluginId(dirPath: string): string {
  const base = baseName(dirPath).replace(/[^\p{L}\p{N}._-]/gu, "-");
  const trimmed = base.replace(/^[-.]+/, "") || "plugin";
  return `local.${trimmed}`;
}

function readManifestForm(plugin: PluginRecord): Partial<PluginManifestForm> {
  const runtime = plugin.runtime;
  const capabilities = plugin.capabilities;
  const preview = runtime?.preview;

  return {
    id: plugin.id || defaultPluginId(plugin.path),
    name: plugin.name || baseName(plugin.path),
    version: plugin.version || "0.0.1",
    publisher: plugin.publisher || "local",
    description: plugin.description ?? "",
    command: runtime?.command ?? "",
    args: (runtime?.args ?? []).join("\n"),
    cwd: runtime?.cwd ?? "",
    env: Object.entries(runtime?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    previewType: preview ? preview.type : "none",
    previewValue: preview ? previewToDraftText(preview) : "",
    spawn: capabilities?.process?.spawn === true,
    notes: capabilities?.qnote?.notes ?? "none",
    todos: capabilities?.qnote?.todos ?? "none",
    clipboard: capabilities?.qnote?.clipboard === "read" ? "read" : "none",
    ai: capabilities?.qnote?.ai === "read" ? "read" : "none",
  };
}

export default function PluginsPage() {
  const { toast } = useToast();
  const isRouteActive = useRouteActive("/plugins");

  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [runtime, setRuntime] = useState<Record<string, PluginRuntimeState>>({});
  const [logs, setLogs] = useState<Record<string, PluginLogLine[]>>({});
  const [previewAddresses, setPreviewAddresses] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [manifestOpen, setManifestOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ path: string; name: string } | null>(
    null
  );
  const [removeOpen, setRemoveOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [cloudBackend, setCloudBackend] = useState<CloudBackend>("local");
  const [previewReloadToken, setPreviewReloadToken] = useState(0);

  const [logCollapsed, setLogCollapsed] = useCollapsedState(LOG_COLLAPSED_KEY, false);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get("plugin");

  useEffect(() => {
    if (!requestedId) return;
    setSelectedId(requestedId);
  }, [requestedId]);

  const handleSelect = useCallback(
    (id: string) => {
      setMarketOpen(false);
      setSelectedId(id);
      const next = new URLSearchParams(searchParams);
      next.set("plugin", id);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const filteredPlugins = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return plugins;
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.id.toLowerCase().includes(kw) ||
        p.path.toLowerCase().includes(kw)
    );
  }, [plugins, keyword]);

  const pluginCountLabel = useMemo(
    () =>
      keyword.trim()
        ? `${filteredPlugins.length} / ${plugins.length}`
        : String(plugins.length),
    [filteredPlugins.length, plugins.length, keyword]
  );

  const selected = useMemo(
    () => plugins.find((p) => p.id === selectedId) ?? null,
    [plugins, selectedId]
  );

  const reload = useCallback(async () => {
    try {
      const [list, states] = await Promise.all([
        window.electron.pluginList(),
        window.electron.pluginRuntimeStates(),
      ]);
      setPlugins(list);
      setRuntime(Object.fromEntries(states.map((r) => [r.pluginId, r])));
    } catch (err) {
      console.error("读取插件管理数据失败", err);
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const list = await window.electron.pluginRefresh();
      setPlugins(list);
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
    const offPlugins = window.electron.onPluginPluginsChanged((next) => {
      setPlugins(next);
    });
    const offRuntime = window.electron.onPluginRuntimeChanged((state) => {
      setRuntime((prev) => ({ ...prev, [state.pluginId]: state }));
    });
    const offLog = window.electron.onPluginLog((line) => {
      setLogs((prev) => {
        const list = prev[line.pluginId] ?? [];
        return { ...prev, [line.pluginId]: [...list, line].slice(-400) };
      });
    });
    return () => {
      offPlugins();
      offRuntime();
      offLog();
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    void (async () => {
      try {
        const lines = await window.electron.pluginLogs(selectedId);
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

      const pluginId = String(message.payload?.pluginId ?? "");
      const manifestHash = String(message.payload?.manifestHash ?? "");
      if (!pluginId || !manifestHash) return;

      void (async () => {
        const res = await window.electron.pluginStart(pluginId, manifestHash);
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
      const picked = await window.electron.pluginPickDir();
      if (!picked) return;

      const res = await window.electron.pluginImport(picked);
      if (res.ok && res.plugin) {
        await reload();
        setSelectedId(res.plugin.id);
        toast({ title: "已导入", description: res.plugin.name });
        return;
      }

      if (res.reason === "missing-manifest" || res.reason === "invalid-manifest") {
        setPendingImport({ path: picked, name: baseName(picked) });
        setManifestOpen(true);
        return;
      }

      if (res.reason === "duplicate-id") {
        toast({
          title: "导入失败",
          description: res.error ?? "已经有一个 id 相同的插件了，换个 id 再导入",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "导入失败",
        description: res.error ?? "该文件夹不符合插件规范",
        variant: "destructive",
      });
    } catch (err) {
      toast({ title: "导入失败", description: String(err), variant: "destructive" });
    }
  }, [reload, toast]);

  const handleStart = useCallback(
    async (plugin: PluginRecord, confirmedManifestHash?: string) => {
      const res = await window.electron.pluginStart(plugin.id, confirmedManifestHash);
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
    async (plugin: PluginRecord) => {
      const res = await window.electron.pluginStop(plugin.id);
      if (!res.ok) {
        toast({ title: "停止失败", description: res.error, variant: "destructive" });
      }
    },
    [toast]
  );

  const handleRestart = useCallback(
    async (plugin: PluginRecord) => {
      await window.electron.pluginStop(plugin.id);
      const res = await window.electron.pluginStart(plugin.id);
      if (res.needsConfirmation) {
        const opened = await window.electron.dialogOpen({
          type: "start-confirm",
          payload: res.needsConfirmation as unknown as Record<string, unknown>,
        });
        if (!opened?.ok) {
          toast({
            title: "重启失败",
            description: opened?.error ?? "打不开确认窗口",
            variant: "destructive",
          });
        }
        return;
      }
      if (!res.ok) {
        toast({
          title: "重启失败",
          description: res.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "插件已重启", description: plugin.name });
    },
    [toast]
  );

  const handleToggleEnabled = useCallback(
    async (plugin: PluginRecord, enabled: boolean) => {
      const res = await window.electron.pluginSetEnabled(plugin.id, enabled);
      if (!res.ok) {
        toast({
          title: enabled ? "启用失败" : "禁用失败",
          description: res.error,
          variant: "destructive",
        });
        return;
      }
      await reload();
    },
    [reload, toast]
  );

  const handleMarketImported = useCallback(
    async (plugin: PluginRecord) => {
      setMarketOpen(false);
      await reload();
      setSelectedId(plugin.id);
    },
    [reload]
  );

  const handlePublish = useCallback(async () => {
    if (!selected) return;
    const opened = await window.electron.dialogOpen({
      type: "publish",
      payload: {
        name: selected.name,
        description: selected.description ?? "",
        manifest: normalizeManifestPreview(selected.manifestText ?? ""),
        pluginId: selected.id,
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
    async (payload: PluginManifestDraft) => {
      const target = pendingImport?.path ?? selected?.path;
      if (!target) return;

      const res = await window.electron.pluginWriteManifest(target, payload);
      if (!res.ok) {
        toast({ title: "保存清单失败", description: res.error, variant: "destructive" });
        throw new Error(res.error ?? "保存失败");
      }

      if (pendingImport) {
        const imported = await window.electron.pluginImport(target);
        if (!imported.ok || !imported.plugin) {
          toast({
            title: "导入失败",
            description: imported.error ?? "这个插件导入失败",
            variant: "destructive",
          });
          throw new Error(imported.error ?? "导入失败");
        }
        setPendingImport(null);
        await reload();
        setSelectedId(imported.plugin.id);
        toast({ title: "已导入", description: imported.plugin.name });
        return;
      }

      await refresh();
      toast({ title: "清单已保存" });
    },
    [pendingImport, selected, reload, refresh, toast]
  );

  const handleRemove = useCallback(async () => {
    if (!selected) return;
    const res = await window.electron.pluginRemove(selected.id);
    setRemoveOpen(false);
    if (!res.ok) {
      toast({ title: "移除失败", description: res.error, variant: "destructive" });
      return;
    }
    setSelectedId(null);
    await reload();
    toast({ title: "已移除插件", description: selected.name });
  }, [selected, reload, toast]);

  const handleClearLogs = useCallback(async () => {
    if (selectedId === null) return;
    await window.electron.pluginClearLogs(selectedId);
    setLogs((prev) => ({ ...prev, [selectedId]: [] }));
  }, [selectedId]);

  const handleOpenFolder = useCallback(
    async (path: string) => {
      const res = await window.electron.pluginOpenFolder(path);
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

  const handlePreviewUrlLoaded = useCallback((localId: number, address: string) => {
    setPreviewAddresses((prev) => ({ ...prev, [localId]: address }));
  }, []);

  const selectedRuntime = selectedId !== null ? runtime[selectedId] : undefined;
  const selectedLogs = selectedId !== null ? (logs[selectedId] ?? []) : [];

  const previewAddress = useMemo(() => {
    if (!selected) return undefined;
    const loaded = previewAddresses[selected.localId];
    if (loaded) return loaded;
    const address = pluginPreviewAddress(selected.runtime?.preview);
    if (address) return address;
    return selected.preview;
  }, [selected, previewAddresses]);

  const manifestTarget = useMemo(() => {
    if (pendingImport) {
      return {
        path: pendingImport.path,
        initial: {
          id: defaultPluginId(pendingImport.path),
          name: pendingImport.name,
          version: "0.0.1",
          publisher: "local",
        } as Partial<PluginManifestForm>,
        title: "补一份 plugin.json",
      };
    }
    if (selected) {
      return {
        path: selected.path,
        initial: readManifestForm(selected),
        title: "插件清单 plugin.json",
      };
    }
    return null;
  }, [pendingImport, selected]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 flex-shrink-0">
        <Button
          type="button"
          variant={marketOpen ? "ghost" : "secondary"}
          size="sm"
          className="h-7 px-2 text-xs btn-hover"
          onClick={() => setMarketOpen(false)}
          aria-pressed={!marketOpen}
          title="管理本机已导入的插件"
        >
          <Boxes className="h-3.5 w-3.5 mr-1" />
          插件管理
        </Button>

        <Button
          type="button"
          variant={marketOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs btn-hover"
          onClick={() => setMarketOpen(true)}
          aria-pressed={marketOpen}
          title="浏览别人发布的插件"
        >
          <Package className="h-3.5 w-3.5 mr-1" />
          插件市场
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

      <div className="flex-1 min-h-0 flex">
        <ResizableSidebar
          storageKey="qnote-plugins-list"
          defaultWidth={320}
          minWidth={240}
          maxWidth={520}
          minContentWidth={420}
          side="left"
          title={
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">插件</span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {pluginCountLabel}
              </span>
            </span>
          }>
          <PluginList
            plugins={filteredPlugins}
            keyword={keyword}
            onKeywordChange={setKeyword}
            runtime={runtime}
            selectedId={selectedId}
            onSelect={handleSelect}
            onImport={() => void handleImport()}
          />
        </ResizableSidebar>

        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          {marketOpen ? (
            <PublishedPluginMarket
              backend={cloudBackend}
              onImported={(plugin) => void handleMarketImported(plugin)}
            />
          ) : !selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <FileCode2 className="h-9 w-9 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {plugins.length === 0 ? "还没有导入任何插件" : "从左侧选一个插件"}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                插件 = 一个文件夹 + 一份 plugin.json 清单。清单决定它怎么启动、预览哪个页面、要哪些权限。
              </p>
              {plugins.length === 0 && (
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
              <PluginHeader
                plugin={selected}
                runtime={selectedRuntime}
                previewAddress={previewAddress}
                onPublish={() => void handlePublish()}
                onStart={() => void handleStart(selected)}
                onStop={() => void handleStop(selected)}
                onEditManifest={() => {
                  setPendingImport(null);
                  setManifestOpen(true);
                }}
                onOpenFolder={() => void handleOpenFolder(selected.path)}
                onRemove={() => setRemoveOpen(true)}
                onToggleEnabled={(enabled) =>
                  void handleToggleEnabled(selected, enabled)
                }
                onShowPermissions={() => setPermissionsOpen(true)}
                onShowSettings={() => setSettingsOpen(true)}
                onRestart={() => void handleRestart(selected)}
                onCopyAddress={(address) => void handleCopyAddress(address)}
                onRefreshPreview={() => setPreviewReloadToken((token) => token + 1)}
              />

              {selected.status !== "ready" && (
                <div
                  className={cn(
                    "flex items-start gap-2 px-3 py-2 border-b flex-shrink-0",
                    selected.status === "incompatible"
                      ? "bg-violet-500/10 border-violet-500/20"
                      : "bg-amber-500/10 border-amber-500/20"
                  )}>
                  <CircleAlert
                    className={cn(
                      "h-4 w-4 flex-shrink-0 mt-0.5",
                      selected.status === "incompatible"
                        ? "text-violet-700 dark:text-violet-400"
                        : "text-amber-700 dark:text-amber-400"
                    )}
                  />
                  <div className="text-xs space-y-1">
                    <p
                      className={cn(
                        "font-medium",
                        selected.status === "incompatible"
                          ? "text-violet-700 dark:text-violet-400"
                          : "text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {selected.status === "missing-manifest"
                        ? "这个文件夹还不是一个可管理的插件"
                        : selected.status === "incompatible"
                          ? "这个插件与当前 QNote 版本不兼容"
                          : "plugin.json 解析失败"}
                    </p>
                    {selected.error && (
                      <p className="text-muted-foreground leading-relaxed">{selected.error}</p>
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
                      {selected.status === "missing-manifest"
                        ? "生成 plugin.json"
                        : selected.status === "incompatible"
                          ? "编辑清单"
                          : "修正清单"}
                    </Button>
                  </div>
                </div>
              )}

              <PluginPreviewPane
                plugin={selected}
                active={isRouteActive}
                suspended={manifestOpen || specOpen || removeOpen}
                reloadToken={previewReloadToken}
                onUrlLoaded={handlePreviewUrlLoaded}
                className="flex-1"
              />

              <PluginLogConsole
                lines={selectedLogs}
                onClear={() => void handleClearLogs()}
                collapsed={logCollapsed}
                onToggleCollapsed={() => setLogCollapsed((v) => !v)}
              />
            </>
          )}
        </section>
      </div>

      {manifestTarget && (
        <PluginManifestDialog
          key={manifestTarget.path}
          open={manifestOpen}
          pluginPath={manifestTarget.path}
          title={manifestTarget.title}
          initial={manifestTarget.initial}
          onClose={() => {
            setManifestOpen(false);
            setPendingImport(null);
          }}
          onSave={handleSaveManifest}
        />
      )}

      <PluginSpecDialog open={specOpen} onClose={() => setSpecOpen(false)} />

      {selected && (
        <Dialog open={permissionsOpen} onOpenChange={setPermissionsOpen}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>插件权限</DialogTitle>
              <DialogDescription>
                {selected.name} 在清单里声明的权限
              </DialogDescription>
            </DialogHeader>
            <PluginPermissionsPanel plugin={selected} />
          </DialogContent>
        </Dialog>
      )}

      {selected && (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>插件设置</DialogTitle>
              <DialogDescription>
                {selected.name} 在清单里声明的设置项
              </DialogDescription>
            </DialogHeader>
            <PluginSettingsPanel plugin={selected} />
          </DialogContent>
        </Dialog>
      )}

      {selected && (
        <RemovePluginDialog
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
