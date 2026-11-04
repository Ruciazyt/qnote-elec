import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * 移除项目确认框
 *
 * 移除会连带停掉正在跑的进程、丢掉清单索引 —— 不可逆，值得问一句。
 */
interface RemoveProjectDialogProps {
  open: boolean;
  /** 项目名 */
  name: string;
  /** 项目绝对路径 */
  path: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RemoveProjectDialog({
  open,
  name,
  path,
  onClose,
  onConfirm,
}: RemoveProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>移除项目</DialogTitle>
          <DialogDescription>
            移除后该项目不再出现在列表里，正在运行的进程会被停止。
            项目文件夹本身与 qnote.json 都不会被删除。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 space-y-0.5">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-[11px] text-muted-foreground/70 font-mono truncate" title={path}>
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
