import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Database, Trash2 } from "lucide-react";

interface ClearVectorConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClearVectorConfirmDialog({ open, onConfirm, onCancel }: ClearVectorConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        onCancel();
      }
    }}>
      <DialogContent className="max-w-md modal-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-orange-600" />
            清空记忆索引
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {/* 正文必须由 DialogDescription 承载 ——
              ui/dialog 不会自动生成描述节点，只有真的渲染了它，
              Radix 才把它的 id 接上 aria-describedby；放在普通 <p> 里，
              读屏在弹窗打开那一瞬间只念得到标题，
              听不出「删的是哪一批记忆」。 */}
          <DialogDescription asChild>
            <p className="text-sm text-muted-foreground">
              确定要清空本地记忆索引吗？
              <br />
              <span className="text-destructive font-medium">此操作不可逆，所有已索引的内容将被删除！</span>
            </p>
          </DialogDescription>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="dialog-cancel-btn">
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="dialog-confirm-btn">
            <Trash2 className="h-4 w-4 mr-1" />
            确定清空
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
