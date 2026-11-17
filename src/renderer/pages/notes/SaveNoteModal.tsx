import { Button } from "@/components/ui/button";
import { getNoteTypeMeta, NoteType } from "../../../shared/notes/noteTypes";

function focusOnMount(node: HTMLInputElement | null) {
  if (node) node.focus();
}

interface SaveNoteModalProps {
  show: boolean;
  saving: boolean;
  filePath: string | null;
  folder: string;
  type: NoteType;
  willOverwrite: boolean;
  customFileName: string;
  onChange: (val: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function SaveNoteModal({
  show,
  saving,
  filePath,
  folder,
  type,
  willOverwrite,
  customFileName,
  onChange,
  onCancel,
  onConfirm,
}: SaveNoteModalProps) {
  if (!show) return null;
  const meta = getNoteTypeMeta(type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 modal-backdrop">
      <div className="bg-card rounded-lg shadow-lg p-6 w-96 border border-border modal-card">
        <h4 className="font-semibold text-lg mb-2 text-card-foreground">
          另存为{meta.label}笔记
        </h4>
        <input
          className="border border-input rounded px-3 py-2 w-full mb-2 text-base bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition
            disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder={`请输入文件名（无需后缀），如 example`}
          value={customFileName}
          onChange={(e) => onChange(e.target.value)}
          ref={focusOnMount}
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving && customFileName.trim()) onConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="text-xs text-muted-foreground mb-4 flex items-start gap-1.5">
          <span className="flex-shrink-0 mt-px">保存到：</span>
          <span className="break-all font-mono">
            {filePath || "未设置路径"}
            {folder ? ` / ${folder}` : ""}
          </span>
          {saving && (
            <span className="ml-1 text-primary/70 flex-shrink-0">
              <span className="loading-dots" />
            </span>
          )}
        </div>
        {willOverwrite && (
          <p className="text-xs text-destructive mb-3">
            同名文件已存在，保存将覆盖它。
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={saving || !customFileName.trim()}
            className={saving ? "relative overflow-hidden" : ""}
          >
            {saving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                保存中
              </>
            ) : (
              "确定保存"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
