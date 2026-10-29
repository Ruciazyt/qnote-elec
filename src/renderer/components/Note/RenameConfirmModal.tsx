import { Button } from "@/components/ui/button";

interface RenameConfirmModalProps {
  show: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function RenameConfirmModal({ show, onCancel, onConfirm }: RenameConfirmModalProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 modal-backdrop">
      <div className="bg-card rounded-lg shadow-lg p-6 w-80 border border-border modal-card">
        <h4 className="font-semibold text-lg mb-2 text-card-foreground">确认保存新文件名？</h4>
        <p className="text-sm text-muted-foreground mb-4">你正在重命名文件，是否保存新名称？</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm}>确定</Button>
        </div>
      </div>
    </div>
  );
}
