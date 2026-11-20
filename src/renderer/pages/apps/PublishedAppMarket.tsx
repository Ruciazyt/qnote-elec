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
import type { AppProject } from "@shared/apps/appTypes";
import type { CloudBackend, PublishedApp } from "@shared/cloud/cloudTypes";


interface PublishedAppMarketProps {
  backend: CloudBackend;
  onImported?: (project: AppProject) => void;
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

export function PublishedAppMarket({
  backend,
  onImported,
}: PublishedAppMarketProps) {
  const { toast } = useToast();
  const [apps, setApps] = React.useState<PublishedApp[]>([]);
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
      setApps(result.data.apps);
      setTotal(result.data.total);
    } catch (err) {
      console.error("读取应用市场失败", err);
      toast({ title: "读取失败", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [keyword, toast]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const handlePull = React.useCallback(
    async (app: PublishedApp) => {
      setBusyId(app.id);
      try {
        let manifest: Record<string, unknown>;
        try {
          manifest = JSON.parse(app.manifest) as Record<string, unknown>;
        } catch {
          toast({
            title: "无法获取",
            description: "这条发布记录的清单格式不对",
            variant: "destructive",
          });
          return;
        }

        const dir = await window.electron.appPickProjectDir();
        if (!dir) return;

        let bundle = "";
        try {
          const detail = await window.electron.cloudGetApp(app.id);
          if (detail.ok) bundle = detail.data?.bundle ?? "";
        } catch (err) {
          console.error("读取发布条目详情失败", err);
        }

        const imported = await window.electron.appImportFromMarket(dir, {
          name: typeof manifest.name === "string" ? manifest.name : app.name,
          description:
            typeof manifest.description === "string" ? manifest.description : app.description,
          command: typeof manifest.command === "string" ? manifest.command : undefined,
          args: Array.isArray(manifest.args) ? manifest.args.map(String) : undefined,
          cwd: typeof manifest.cwd === "string" ? manifest.cwd : undefined,
          env:
            manifest.env && typeof manifest.env === "object" && !Array.isArray(manifest.env)
              ? Object.fromEntries(
                  Object.entries(manifest.env as Record<string, unknown>).map(([k, v]) => [
                    k,
                    String(v),
                  ])
                )
              : undefined,
          preview:
            typeof manifest.preview === "string" || typeof manifest.preview === "number"
              ? manifest.preview
              : undefined,
          bundle,
        });

        if (!imported.ok) {
          toast({
            title: "获取失败",
            description: imported.error ?? "导入失败",
            variant: "destructive",
          });
          return;
        }

        void window.electron.cloudMarkPulled(app.id);
        toast({
          title: "已获取",
          description: `${app.name} —— 第一次运行前会请你确认它要执行的命令`,
        });
        if (imported.project) onImported?.(imported.project);
      } catch (err) {
        console.error("获取应用失败", err);
        toast({ title: "获取失败", description: String(err), variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [onImported, toast]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {}
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
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索已发布的应用"
            className="h-7 pl-7 text-xs"
            aria-label="搜索已发布的应用"
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

      {}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <Package className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-[13px] text-muted-foreground/70">
              {loading ? "加载中..." : keyword ? "没有匹配的应用" : "还没有发布过应用"}
            </p>
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
              {keyword
                ? "换个关键词试试"
                : "把项目发布上来，别人装上 QNote 就能看到"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {apps.map((app) => (
              <li
                key={app.id}
                className="px-3 py-2.5 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {app.name}
                      </span>
                      {app.author && (
                        <span className="text-[11px] text-muted-foreground/60 shrink-0">
                          {app.author}
                        </span>
                      )}
                    </div>
                    {app.description && (
                      <p className="text-[12px] text-muted-foreground/75 leading-relaxed mt-0.5 line-clamp-2">
                        {app.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/50">
                      <span>被获取 {app.pulls} 次</span>
                      {app.tags && <span className="truncate">{app.tags}</span>}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handlePull(app)}
                    disabled={busyId === app.id}
                    className="h-7 px-2 text-xs shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  >
                    {busyId === app.id ? (
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3 mr-1" />
                    )}
                    获取
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {}
      <div className="px-3 py-1.5 border-t border-border/60 text-[11px] text-muted-foreground/60">
        共 {total} 个已发布的应用
      </div>
    </div>
  );
}
