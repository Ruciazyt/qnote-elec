import * as React from "react";
import { RefreshCw, Upload } from "lucide-react";
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

export interface PublishTarget {
  name: string;
  description: string;
  manifest: string;
  projectId: number;
}

interface PublishDialogProps {
  target: PublishTarget | null;
  onClose: () => void;
}

interface BundlePreview {
  bundle: string;
  fileCount: number;
  bytes: number;
  skipped: string[];
  tooLarge: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PublishDialog({ target, onClose }: PublishDialogProps) {
  const [description, setDescription] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [packed, setPacked] = React.useState<BundlePreview | null>(null);

  React.useEffect(() => {
    setDescription(target?.description ?? "");
    setAuthor("");
    setRepoUrl("");
    setTags("");
    setError(null);
    setNote(null);
    setPacked(null);
  }, [target]);

  React.useEffect(() => {
    if (!target) return;
    let alive = true;
    void (async () => {
      try {
        const res = await window.electron.appBuildBundle(target.projectId);
        if (!alive) return;
        if (!res.ok) {
          setError(res.error ?? "读取项目文件失败");
          return;
        }
        setPacked({
          bundle: res.bundle ?? "",
          fileCount: res.fileCount ?? 0,
          bytes: res.bytes ?? 0,
          skipped: res.skipped ?? [],
          tooLarge: Boolean(res.tooLarge),
        });
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  const handleSubmit = async () => {
    if (!target || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await window.electron.cloudPublishApp({
        name: target.name,
        description: description || target.description || "",
        author,
        manifest: target.manifest,
        repoUrl,
        tags,
        bundle: packed && !packed.tooLarge ? packed.bundle : "",
      });
      if (!result.ok) {
        setError(result.error ?? "发布失败");
        setPublishing(false);
        return;
      }
      if (result.data.bundleDropped) {
        setNote("公共目录还不支持上传资源，本次只发布了清单");
      }
      window.electron.dialogSend({
        action: "published",
        payload: { name: result.data.name },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPublishing(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>发布到应用市场</DialogTitle>
          <DialogDescription>
            发布的是清单与项目文件 —— 别人「获取」时会把两者一起装到本地，
            装完就能直接运行。依赖目录、缓存与密钥文件不会上传。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80 block">应用名</label>
            <Input value={target?.name ?? ""} disabled className="h-9 text-xs" />
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

          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-1">
            <p className="text-[12px] text-foreground/85 flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              {packed
                ? packed.tooLarge
                  ? "项目文件超过 8MB，本次只发布清单"
                  : `会一起上传 ${packed.fileCount} 个文件（${formatBytes(packed.bytes)}）`
                : "正在统计项目文件…"}
            </p>
            {packed && packed.skipped.length > 0 && (
              <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                已跳过 {packed.skipped.length} 项（依赖目录、缓存与密钥文件不上传）
              </p>
            )}
          </div>

          {note && (
            <p className="text-[12px] text-amber-700 dark:text-amber-400 leading-relaxed">
              {note}
            </p>
          )}
          {error && (
            <p className="text-[12px] text-destructive leading-relaxed" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} className="h-9">
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={publishing || !target}
            className="h-9 btn-hover"
          >
            {publishing && <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />}
            {publishing ? "发布中..." : "发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
