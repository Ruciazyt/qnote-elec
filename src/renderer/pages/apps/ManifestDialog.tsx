import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface ManifestDraft {
  name: string;
  description: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  preview: string;
}

interface ManifestDialogProps {
  open: boolean;
  projectPath: string;
  title?: string;
  initial?: Partial<ManifestDraft>;
  onClose: () => void;
  onSave: (payload: ManifestPayload) => Promise<void>;
}

export interface ManifestPayload {
  name?: string;
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  preview?: string;
}

const EMPTY: ManifestDraft = {
  name: "",
  description: "",
  command: "",
  args: "",
  cwd: "",
  env: "",
  preview: "",
};

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

export function ManifestDialog({
  open,
  projectPath,
  title,
  initial,
  onClose,
  onSave,
}: ManifestDialogProps) {
  const [draft, setDraft] = useState<ManifestDraft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const initialRef = useRef(initial);
  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    const init = initialRef.current;
    setDraft({
      name: init?.name ?? "",
      description: init?.description ?? "",
      command: init?.command ?? "",
      args: init?.args ?? "",
      cwd: init?.cwd ?? "",
      env: init?.env ?? "",
      preview: init?.preview ?? "",
    });
  }, [open]);

  const set = <K extends keyof ManifestDraft>(key: K, value: ManifestDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const args = draft.args
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);
  const env = parseEnv(draft.env);
  const canSave = Boolean(draft.command.trim() || draft.preview.trim());

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSave({
        name: draft.name.trim() || undefined,
        description: draft.description.trim() || undefined,
        command: draft.command.trim() || undefined,
        args: args.length > 0 ? args : undefined,
        cwd: draft.cwd.trim() || undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
        preview: draft.preview.trim() || undefined,
      });
      onClose();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? "项目清单 qnote.json"}</DialogTitle>
          <DialogDescription>
            文件将写入 <span className="font-mono text-xs">{projectPath}</span> 目录。
            填「启动命令」或「预览页面」其中之一即可。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mf-name">名称</Label>
              <Input
                id="mf-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="留空则用文件夹名"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-cwd">工作目录</Label>
              <Input
                id="mf-cwd"
                value={draft.cwd}
                onChange={(e) => set("cwd", e.target.value)}
                placeholder="留空则项目根目录"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mf-desc">说明</Label>
            <Input
              id="mf-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="这个项目是做什么的（可选）"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mf-command">启动命令</Label>
            <Input
              id="mf-command"
              value={draft.command}
              onChange={(e) => set("command", e.target.value)}
              placeholder="例如 node server.js 或 python main.py"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              以常驻进程运行，点「停止」才结束；标准输出与错误输出会实时显示在下方控制台。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mf-args">启动参数</Label>
            <Textarea
              id="mf-args"
              value={draft.args}
              onChange={(e) => set("args", e.target.value)}
              placeholder={"一行一个，例如：\n--port\n3000"}
              className="min-h-[64px] font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mf-preview">预览页面</Label>
            <Input
              id="mf-preview"
              value={draft.preview}
              onChange={(e) => set("preview", e.target.value)}
              placeholder="端口号 7799，或项目内的相对路径 dist/index.html"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              填端口号就自动打开 http://127.0.0.1:端口/；填相对路径则按项目根目录解析。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mf-env">环境变量</Label>
            <Textarea
              id="mf-env"
              value={draft.env}
              onChange={(e) => set("env", e.target.value)}
              placeholder={"一行一个 KEY=VALUE，例如：\nNODE_ENV=production"}
              className="min-h-[64px] font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="btn-hover">
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving} className="btn-hover">
            {saving ? "保存中..." : "保存清单"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
