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
import { isValidPluginId, parseSemver } from "@shared/plugin/pluginManifest";
import { parsePortText } from "@shared/plugin/pluginPreview";
import type {
  PluginCapabilities,
  PluginDataAccess,
  PluginManifestDraft,
  PluginPreviewSpec,
  PluginRuntimeConfig,
} from "@shared/plugin/pluginTypes";

export type PluginPreviewType = "none" | "port" | "url" | "path";

export interface PluginManifestForm {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  previewType: PluginPreviewType;
  previewValue: string;
  spawn: boolean;
  notes: PluginDataAccess;
  todos: PluginDataAccess;
  clipboard: "none" | "read";
  ai: "none" | "read";
}

interface PluginManifestDialogProps {
  open: boolean;
  pluginPath: string;
  title?: string;
  initial?: Partial<PluginManifestForm>;
  onClose: () => void;
  onSave: (payload: PluginManifestDraft) => Promise<void>;
}

const EMPTY: PluginManifestForm = {
  id: "",
  name: "",
  version: "0.0.1",
  publisher: "local",
  description: "",
  command: "",
  args: "",
  cwd: "",
  env: "",
  previewType: "none",
  previewValue: "",
  spawn: false,
  notes: "none",
  todos: "none",
  clipboard: "none",
  ai: "none",
};

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

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

function buildPreview(
  type: PluginPreviewType,
  value: string
): PluginPreviewSpec | undefined {
  const text = value.trim();
  if (type === "none" || !text) return undefined;
  if (type === "port") {
    const port = parsePortText(text);
    return port ? { type: "port", port } : undefined;
  }
  if (type === "url") return { type: "url", url: text };
  return { type: "path", path: text };
}

export function PluginManifestDialog({
  open,
  pluginPath,
  title,
  initial,
  onClose,
  onSave,
}: PluginManifestDialogProps) {
  const [draft, setDraft] = useState<PluginManifestForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const initialRef = useRef(initial);
  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    const init = initialRef.current;
    setDraft({ ...EMPTY, ...init });
  }, [open]);

  const set = <K extends keyof PluginManifestForm>(
    key: K,
    value: PluginManifestForm[K]
  ) => setDraft((prev) => ({ ...prev, [key]: value }));

  const setCommand = (value: string) =>
    setDraft((prev) => ({
      ...prev,
      command: value,
      spawn: value.trim() ? true : prev.spawn,
    }));

  const args = draft.args
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);
  const env = parseEnv(draft.env);
  const preview = buildPreview(draft.previewType, draft.previewValue);

  const idValid = isValidPluginId(draft.id.trim());
  const versionValid = Boolean(parseSemver(draft.version.trim()));
  const hasRuntime = Boolean(draft.command.trim()) || Boolean(preview);
  const previewValid =
    draft.previewType === "none" ? true : Boolean(preview);
  const canSave =
    idValid &&
    versionValid &&
    draft.name.trim().length > 0 &&
    hasRuntime &&
    previewValid;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);

    const runtime: PluginRuntimeConfig = {};
    const command = draft.command.trim();
    if (command) runtime.command = command;
    if (args.length > 0) runtime.args = args;
    const cwd = draft.cwd.trim();
    if (cwd) runtime.cwd = cwd;
    if (Object.keys(env).length > 0) runtime.env = env;
    if (preview) runtime.preview = preview;

    const capabilities: PluginCapabilities = {
      process: { spawn: draft.spawn },
      qnote: {
        notes: draft.notes,
        todos: draft.todos,
        clipboard: draft.clipboard,
        ai: draft.ai,
      },
    };

    try {
      await onSave({
        id: draft.id.trim(),
        name: draft.name.trim(),
        version: draft.version.trim(),
        publisher: draft.publisher.trim(),
        description: draft.description.trim(),
        runtime,
        capabilities,
      });
      onClose();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title ?? "插件清单 plugin.json"}</DialogTitle>
          <DialogDescription>
            文件将写入 <span className="font-mono text-xs">{pluginPath}</span> 目录。
            填「启动命令」或「预览页面」其中之一即可。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mf-id">插件 ID</Label>
              <Input
                id="mf-id"
                value={draft.id}
                onChange={(e) => set("id", e.target.value)}
                placeholder="local.my-plugin"
                className="font-mono text-xs"
              />
              <p
                className={
                  draft.id.trim() && !idValid
                    ? "text-[11px] text-destructive leading-relaxed"
                    : "text-[11px] text-muted-foreground leading-relaxed"
                }>
                必须是 publisher.name 格式，只能用字母、数字、点和短横线。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-name">名称</Label>
              <Input
                id="mf-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="留空则用文件夹名"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mf-version">版本</Label>
              <Input
                id="mf-version"
                value={draft.version}
                onChange={(e) => set("version", e.target.value)}
                placeholder="1.0.0"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-publisher">发布者</Label>
              <Input
                id="mf-publisher"
                value={draft.publisher}
                onChange={(e) => set("publisher", e.target.value)}
                placeholder="local"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-cwd">工作目录</Label>
              <Input
                id="mf-cwd"
                value={draft.cwd}
                onChange={(e) => set("cwd", e.target.value)}
                placeholder="留空则插件根目录"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mf-desc">说明</Label>
            <Input
              id="mf-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="这个插件是做什么的（可选）"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mf-command">启动命令</Label>
            <Input
              id="mf-command"
              value={draft.command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="例如 node server.js 或 python main.py"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              以常驻进程运行，点「停止」才结束；标准输出与错误输出会实时显示在下方控制台。
              填了命令就必须勾上「允许启动子进程」，否则插件装上了也起不来。
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mf-preview-type">预览类型</Label>
              <select
                id="mf-preview-type"
                className={SELECT_CLASS}
                value={draft.previewType}
                onChange={(e) =>
                  set("previewType", e.target.value as PluginPreviewType)
                }>
                <option value="none">不预览</option>
                <option value="port">端口</option>
                <option value="url">网址</option>
                <option value="path">相对路径</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-preview-value">预览地址</Label>
              <Input
                id="mf-preview-value"
                value={draft.previewValue}
                onChange={(e) => set("previewValue", e.target.value)}
                disabled={draft.previewType === "none"}
                placeholder={
                  draft.previewType === "port"
                    ? "7799"
                    : draft.previewType === "url"
                      ? "http://127.0.0.1:7799/"
                      : "dist/index.html"
                }
                className="font-mono text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            端口会自动打开 http://127.0.0.1:端口/；相对路径按插件根目录解析。
          </p>

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

          <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
            <p className="text-[13px] font-medium">权限</p>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.spawn}
                onChange={(e) => set("spawn", e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              <span className="text-[12px] text-foreground">允许启动子进程</span>
            </label>
            {draft.command.trim() && !draft.spawn && (
              <p className="text-[11px] text-destructive leading-relaxed">
                填了启动命令就得允许启动子进程，否则这个插件装上了也起不来。
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="mf-cap-notes" className="text-[11px]">
                  笔记
                </Label>
                <select
                  id="mf-cap-notes"
                  className={SELECT_CLASS}
                  value={draft.notes}
                  onChange={(e) =>
                    set("notes", e.target.value as PluginDataAccess)
                  }>
                  <option value="none">不访问</option>
                  <option value="read">只读</option>
                  <option value="write">可读写</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mf-cap-todos" className="text-[11px]">
                  待办
                </Label>
                <select
                  id="mf-cap-todos"
                  className={SELECT_CLASS}
                  value={draft.todos}
                  onChange={(e) =>
                    set("todos", e.target.value as PluginDataAccess)
                  }>
                  <option value="none">不访问</option>
                  <option value="read">只读</option>
                  <option value="write">可读写</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mf-cap-clipboard" className="text-[11px]">
                  剪贴板
                </Label>
                <select
                  id="mf-cap-clipboard"
                  className={SELECT_CLASS}
                  value={draft.clipboard}
                  onChange={(e) =>
                    set("clipboard", e.target.value as "none" | "read")
                  }>
                  <option value="none">不访问</option>
                  <option value="read">只读</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mf-cap-ai" className="text-[11px]">
                  AI
                </Label>
                <select
                  id="mf-cap-ai"
                  className={SELECT_CLASS}
                  value={draft.ai}
                  onChange={(e) => set("ai", e.target.value as "none" | "read")}>
                  <option value="none">不访问</option>
                  <option value="read">只读</option>
                </select>
              </div>
            </div>
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
