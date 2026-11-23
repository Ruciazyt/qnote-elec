import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface RemovePluginDialogProps {
  open: boolean;
  name: string;
  path: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RemovePluginDialog({
  open,
  name,
  path,
  onClose,
  onConfirm,
}: RemovePluginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>移除插件</DialogTitle>
          <DialogDescription>
            确定要移除插件「<span className="font-medium text-foreground">{name}</span>」吗？
            <span className="block mt-1">
              移除后该插件不再出现在列表里，正在运行的进程会被停止；
              插件文件夹本身与 plugin.json 都不会被删除。
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <p className="text-[11px] text-muted-foreground font-mono truncate" title={path}>
            {path}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="btn-hover">
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="btn-hover">
            移除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
