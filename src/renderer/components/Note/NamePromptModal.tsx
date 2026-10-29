import { Button } from "@/components/ui/button";

interface NamePromptModalProps {
  show: boolean;
  title: string;
  placeholder?: string;
  hint?: string;
  value: string;
  busy?: boolean;
  onChange: (val: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 单行文本输入弹窗
 *
 * 不用 window.prompt —— Electron 渲染进程里它会直接抛
 * "prompt() is and will not be supported"，必须自己实现。
 */
export default function NamePromptModal({
  show,
  title,
  placeholder,
  hint,
  value,
  busy = false,
  onChange,
  onCancel,
  onConfirm,
}: NamePromptModalProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 modal-backdrop">
      <div className="bg-card rounded-lg shadow-lg p-6 w-80 border border-border modal-card">
        <h4 className="font-semibold text-lg mb-3 text-card-foreground">{title}</h4>
        <input
          className="border border-input rounded px-3 py-2 w-full mb-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition
            disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder={placeholder}
          value={value}
          autoFocus
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && value.trim()) onConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        {hint && <p className="text-xs text-muted-foreground mb-4 break-all">{hint}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={busy || !value.trim()}>
            {busy ? "处理中" : "确定"}
          </Button>
        </div>
      </div>
    </div>
  );
}
