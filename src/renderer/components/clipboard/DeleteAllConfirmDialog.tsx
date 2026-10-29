import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Trash2 } from "lucide-react";

interface DeleteAllConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * 清空前统计：会删多少、会保留多少（置顶 + 重要）。
   * 不先告诉用户「会保留 12 条」，他看到的仍是「清空所有记录」，
   * 删完发现重要的还在，会以为功能坏了。
   */
  stats?: { kept: number; total: number; removable: number } | null;
}

export function DeleteAllConfirmDialog({ open, onConfirm, onCancel, stats }: DeleteAllConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        onCancel();
      }
    }}>
      <DialogContent className="max-w-md modal-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            清空所有记录
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            {stats && stats.kept > 0 ? (
              <>
                将删除 <span className="text-foreground font-medium">{stats.removable}</span> 条记录。
                <br />
                <span className="text-amber-600 dark:text-amber-500 font-medium">
                  其中 {stats.kept} 条已置顶或标记为重要，会被保留。
                </span>
              </>
            ) : (
              <>
                确定要清空所有剪贴板记录吗？
                <br />
                <span className="text-muted-foreground/70 text-xs">
                  当前没有置顶或标记为重要的记录。
                </span>
              </>
            )}
            <br />
            <span className="text-destructive font-medium">此操作不可逆！</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="dialog-cancel-btn">
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="dialog-confirm-btn">
            {stats && stats.kept > 0 ? `删除 ${stats.removable} 条` : "确定清空"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
