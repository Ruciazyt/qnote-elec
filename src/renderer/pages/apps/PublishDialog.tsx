import * as React from "react";
import { RefreshCw } from "lucide-react";
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
}

interface PublishDialogProps {
  target: PublishTarget | null;
  onClose: () => void;
}

export function PublishDialog({ target, onClose }: PublishDialogProps) {
  const [description, setDescription] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDescription(target?.description ?? "");
    setAuthor("");
    setRepoUrl("");
    setTags("");
    setError(null);
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
      });
      if (!result.ok) {
        setError(result.error ?? "发布失败");
        setPublishing(false);
        return;
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
            发布的只有清单与简介 —— 项目代码不会被上传，
            别人「获取」时拿到的是清单，本机的项目文件始终在你手里。
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
