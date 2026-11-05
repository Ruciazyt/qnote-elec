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
          {/* 描述节点里要点名 —— 读屏打开这个框只念得到标题「移除项目」，
              听不出删的是哪一个项目（项目名原来在描述节点之外的另一个 div 里，
              看得见读不到）。名字用「」包住并提到 foreground 层级，
              不可逆的后果单独一行，不和问句挤在一句里。 */}
          <DialogDescription>
            确定要移除项目「<span className="font-medium text-foreground">{name}</span>」吗？
            <span className="block mt-1">
              移除后该项目不再出现在列表里，正在运行的进程会被停止；
              项目文件夹本身与 qnote.json 都不会被删除。
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* 项目名已经挪进上面的描述节点，这里只留路径 —— 同一屏里重复两遍名字
            只会稀释「删的是哪一个」这层强调。 */}
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
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
