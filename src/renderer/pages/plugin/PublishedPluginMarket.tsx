import * as React from "react";
import {
  Cloud,
  CloudOff,
  Download,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/ui/use-toast";
import { cn } from "@/lib/utils";
import { parseLegacyPreview, parsePluginPreview } from "@shared/plugin/pluginPreview";
import type {
  MarketImportPayload,
  PluginCapabilities,
  PluginRecord,
  PluginRuntimeConfig,
} from "@shared/plugin/pluginTypes";
import type { CloudBackend, PublishedApp } from "@shared/cloud/cloudTypes";

interface PublishedPluginMarketProps {
  backend: CloudBackend;
  onImported?: (plugin: PluginRecord) => void;
}

const BACKEND_BADGE: Record<
  CloudBackend,
  { label: string; className: string; title: string }
> = {
  catalog: {
    label: "公共目录",
    className: "bg-primary/10 text-primary-strong border-primary/25",
    title: "目录放在公共目录 —— 所有装了 QNote 的人看到同一份目录",
  },
  local: {
    label: "本地",
    className: "bg-muted text-muted-foreground border-border",
    title: "发布目录存在本机，换台电脑看不到",
  },
};

function slugOf(text: string): string {
  const parts: string[] = [];
  for (const ch of text.toLowerCase()) {
    const isLetter = ch >= "a" && ch <= "z";
    const isDigit = ch >= "0" && ch <= "9";
    if (isLetter || isDigit) {
      parts.push(ch);
      continue;
    }
    if (parts.length > 0 && parts[parts.length - 1] !== "-") parts.push("-");
  }
  while (parts.length > 0 && parts[parts.length - 1] === "-") parts.pop();
  return parts.join("") || "plugin";
}

function readManifestObject(manifestText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(manifestText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toMarketPayload(
  manifestText: string,
  fallbackName: string,
  bundle: string
): MarketImportPayload | null {
  const raw = readManifestObject(manifestText);
  if (!raw) return null;

  const runtimeSource =
    raw.runtime && typeof raw.runtime === "object" && !Array.isArray(raw.runtime)
      ? (raw.runtime as Record<string, unknown>)
      : {};

  const runtime: PluginRuntimeConfig = {};

  const command =
    typeof runtimeSource.command === "string"
      ? runtimeSource.command
      : typeof raw.command === "string"
        ? raw.command
        : "";
  if (command.trim()) runtime.command = command.trim();

  const args = Array.isArray(runtimeSource.args)
    ? runtimeSource.args.map(String)
    : Array.isArray(raw.args)
      ? raw.args.map(String)
      : [];
  if (args.length > 0) runtime.args = args;

  const cwd =
    typeof runtimeSource.cwd === "string"
      ? runtimeSource.cwd
      : typeof raw.cwd === "string"
        ? raw.cwd
        : "";
  if (cwd.trim()) runtime.cwd = cwd.trim();

  const envSource =
    runtimeSource.env && typeof runtimeSource.env === "object" && !Array.isArray(runtimeSource.env)
      ? (runtimeSource.env as Record<string, unknown>)
      : raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
        ? (raw.env as Record<string, unknown>)
        : null;
  if (envSource) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(envSource)) env[key] = String(value);
    if (Object.keys(env).length > 0) runtime.env = env;
  }

  const preview =
    parsePluginPreview(runtimeSource.preview) ??
    parseLegacyPreview(runtimeSource.preview) ??
    parseLegacyPreview(raw.preview);
  if (preview) runtime.preview = preview;

  const name =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName;
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `market.${slugOf(name)}`;

  const payload: MarketImportPayload = { id, name, runtime };

  if (typeof raw.version === "string" && raw.version.trim()) {
    payload.version = raw.version.trim();
  }
  if (typeof raw.publisher === "string" && raw.publisher.trim()) {
    payload.publisher = raw.publisher.trim();
  }
  if (typeof raw.description === "string") payload.description = raw.description;
  if (typeof raw.license === "string") payload.license = raw.license;
  if (typeof raw.icon === "string") payload.icon = raw.icon;

  const engines = raw.engines;
  if (engines && typeof engines === "object" && !Array.isArray(engines)) {
    const qnote = (engines as Record<string, unknown>).qnote;
    if (typeof qnote === "string" && qnote.trim()) {
      payload.engines = { qnote: qnote.trim() };
    }
  }

  if (
    raw.capabilities &&
    typeof raw.capabilities === "object" &&
    !Array.isArray(raw.capabilities)
  ) {
    payload.capabilities = raw.capabilities as PluginCapabilities;
  }

  if (bundle) payload.bundle = bundle;

  return payload;
}

export function PublishedPluginMarket({
  backend,
  onImported,
}: PublishedPluginMarketProps) {
  const { toast } = useToast();
  const [plugins, setPlugins] = React.useState<PublishedApp[]>([]);
  const [total, setTotal] = React.useState(0);
  const [keyword, setKeyword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electron.cloudListApps({
        keyword: keyword.trim() || undefined,
        limit: 100,
      });
      if (!result.ok) {
        toast({
          title: "读取失败",
          description: result.error,
          variant: "destructive",
        });
        return;
      }
      setPlugins(result.data.apps);
      setTotal(result.data.total);
    } catch (err) {
      console.error("读取插件市场失败", err);
      toast({ title: "读取失败", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [keyword, toast]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const handlePull = React.useCallback(
    async (entry: PublishedApp) => {
      setBusyId(entry.id);
      try {
        let bundle = "";
        try {
          const detail = await window.electron.cloudGetApp(entry.id);
          if (detail.ok) bundle = detail.data?.bundle ?? "";
        } catch (err) {
          console.error("读取发布条目详情失败", err);
        }

        const payload = toMarketPayload(entry.manifest, entry.name, bundle);
        if (!payload) {
          toast({
            title: "无法获取",
            description: "这条发布记录的清单格式不对",
            variant: "destructive",
          });
          return;
        }

        const dir = await window.electron.pluginPickDir();
        if (!dir) return;

        const imported = await window.electron.pluginImportFromMarket(dir, payload);
        if (!imported.ok) {
          toast({
            title: "获取失败",
            description: imported.error ?? "导入失败",
            variant: "destructive",
          });
          return;
        }

        void window.electron.cloudMarkPulled(entry.id);
        toast({
          title: "已获取",
          description: `${entry.name} —— 第一次运行前会请你确认它要执行的命令`,
        });
        if (imported.plugin) onImported?.(imported.plugin);
      } catch (err) {
        console.error("获取插件失败", err);
        toast({ title: "获取失败", description: String(err), variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [onImported, toast]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border shrink-0",
            BACKEND_BADGE[backend].className
          )}
          title={BACKEND_BADGE[backend].title}
        >
          {backend === "local" ? (
            <CloudOff className="h-3 w-3" />
          ) : (
            <Cloud className="h-3 w-3" />
          )}
          {BACKEND_BADGE[backend].label}
        </span>

        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索已发布的插件"
            className="h-7 pl-7 text-xs"
            aria-label="搜索已发布的插件"
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void reload()}
          disabled={loading}
          className="h-7 px-2"
          aria-label="刷新列表"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {plugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <Package className="h-8 w-8 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">
              {loading ? "加载中..." : keyword ? "没有匹配的插件" : "还没有发布过插件"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {keyword
                ? "换个关键词试试"
                : "把插件发布上来，别人装上 QNote 就能看到"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {plugins.map((entry) => {
              const manifest = readManifestObject(entry.manifest);
              const version =
                manifest && typeof manifest.version === "string" ? manifest.version : "";

              return (
                <li
                  key={entry.id}
                  className="px-3 py-2.5 hover:bg-muted/30 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-foreground truncate">
                          {entry.name}
                        </span>
                        {version && (
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            v{version}
                          </span>
                        )}
                        {entry.author && (
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {entry.author}
                          </span>
                        )}
                      </div>
                      {entry.description && (
                        <p className="text-[12px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
                          {entry.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                        <span>被获取 {entry.pulls} 次</span>
                        {entry.tags && <span className="truncate">{entry.tags}</span>}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handlePull(entry)}
                      disabled={busyId === entry.id}
                      className="h-7 px-2 text-xs shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    >
                      {busyId === entry.id ? (
                        <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3 mr-1" />
                      )}
                      获取
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-border/60 text-[11px] text-muted-foreground">
        共 {total} 个已发布的插件
      </div>
    </div>
  );
}
