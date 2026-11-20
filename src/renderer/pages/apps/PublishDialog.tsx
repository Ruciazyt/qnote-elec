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
import type { AppProject } from "@shared/apps/appTypes";

export interface PublishPayload {
  description: string;
  author: string;
  repoUrl: string;
  tags: string;
}

interface PublishDialogProps {
  open: boolean;
  project: AppProject | null;
  onClose: () => void;
  onSubmit: (payload: PublishPayload) => void;
  submitting: boolean;
}

export function PublishDialog({
  open,
  project,
  onClose,
  onSubmit,
  submitting,
}: PublishDialogProps) {
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
