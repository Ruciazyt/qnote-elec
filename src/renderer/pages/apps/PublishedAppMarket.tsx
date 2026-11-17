import * as React from "react";
import {
  Cloud,
  CloudOff,
  Download,
  Package,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/ui/use-toast";
import { cn } from "@/lib/utils";
import type { AppProject } from "@shared/apps/appTypes";
import type { CloudBackend, PublishedApp } from "@shared/cloud/cloudTypes";


interface PublishedAppMarketProps {
  selectedProject: AppProject | null;
  backend: CloudBackend;
  onChanged?: () => void;
}

const BACKEND_BADGE: Record<
  CloudBackend,
  { label: string; className: string; title: string }
> = {
  public: {
    label: "公共",
    className: "bg-primary/10 text-primary-strong border-primary/25",
    title: "公共目录（Worker 代理）—— 所有装了 QNote 的人看到同一份目录",
  },
  d1: {
    label: "自建 D1",
    className: "bg-primary/10 text-primary-strong border-primary/25",
    title: "你自己的 Cloudflare D1 库",
  },
  local: {
    label: "本地",
    className: "bg-muted text-muted-foreground border-border",
    title: "发布目录存在本机，换台电脑看不到",
  },
};

export function PublishedAppMarket({
  selectedProject,
  backend,
  onChanged,
}: PublishedAppMarketProps) {
  const { toast } = useToast();
  const [apps, setApps] = React.useState<PublishedApp[]>([]);
  const [total, setTotal] = React.useState(0);
  const [keyword, setKeyword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);

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

  const handlePublish = React.useCallback(
    async (payload: {
      description: string;
      author: string;
      repoUrl: string;
      tags: string;
    }) => {
      if (!selectedProject) return;
      setPublishing(true);
      try {
        const result = await window.electron.cloudPublishApp({
          name: selectedProject.name,
          description: payload.description || selectedProject.description || "",
          author: payload.author,
          manifest: selectedProject.manifestText ?? "",
          repoUrl: payload.repoUrl,
          tags: payload.tags,
        });
        if (!result.ok) {
          toast({
            title: "发布失败",
            description: result.error,
            variant: "destructive",
          });
          return;
        }
        toast({ title: "已发布", description: result.data.name });
        setPublishOpen(false);
        await reload();
        onChanged?.();
      } catch (err) {
        console.error("发布失败", err);
        toast({ title: "发布失败", description: String(err), variant: "destructive" });
      } finally {
        setPublishing(false);
      }
    },
    [selectedProject, reload, onChanged, toast]
  );

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
          preview: typeof manifest.preview === "string" ? manifest.preview : undefined,
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
        onChanged?.();
      } catch (err) {
        console.error("获取应用失败", err);
        toast({ title: "获取失败", description: String(err), variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [onChanged, toast]
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

        <Button
          type="button"
          size="sm"
          onClick={() => setPublishOpen(true)}
          disabled={!selectedProject}
          className="h-7 text-xs shrink-0"
          title={
            selectedProject
              ? "把当前选中的项目发布到应用市场"
              : "先在左边选一个项目"
          }
        >
          <Upload className="h-3.5 w-3.5 mr-1" />
          发布
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
                : "选中左边的项目，点右上角「发布」把它放上来"}
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

      <PublishDialog
        open={publishOpen}
        project={selectedProject}
        onClose={() => setPublishOpen(false)}
        onSubmit={handlePublish}
        submitting={publishing}
      />
    </div>
  );
}

function PublishDialog({
  open,
  project,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  project: AppProject | null;
  onClose: () => void;
  onSubmit: (payload: {
    description: string;
    author: string;
    repoUrl: string;
    tags: string;
  }) => void;
  submitting: boolean;
}) {
  const [description, setDescription] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [tags, setTags] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setDescription(project?.description ?? "");
      setAuthor("");
      setRepoUrl("");
      setTags("");
    }
  }, [open, project]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>发布到应用市场</DialogTitle>
          <DialogDescription>
            发布的只有清单与简介 —— 项目代码不会被上传，
            别人「获取」时拿到的是清单，本机的项目文件始终在你手里。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80 block">应用名</label>
            <Input value={project?.name ?? ""} disabled className="h-9 text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80 block">简介</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说明这个应用做什么"
              className="text-xs min-h-[60px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">作者</label>
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="署名"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">标签</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="逗号分隔"
                className="h-9 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80 block">仓库地址</label>
            <Input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/…"
              className="h-9 text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} className="h-9">
            取消
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSubmit({ description, author, repoUrl, tags })
            }
            disabled={submitting || !project}
            className="h-9 btn-hover"
          >
            {submitting && <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />}
            {submitting ? "发布中..." : "发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
