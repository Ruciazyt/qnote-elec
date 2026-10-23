import { useEffect, useMemo, useState } from "react";
import { Link2, AppWindow, Folder, FolderOpen, Loader2, MousePointerClick } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ShortcutKind, ShortcutRow, ShellMenuStatus } from "./types";

const KIND_OPTIONS: Array<{
  value: ShortcutKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "url", label: "网页", icon: Link2 },
  { value: "app", label: "程序", icon: AppWindow },
  { value: "folder", label: "文件夹", icon: Folder },
];

/** 主进程推导标题的同一套规则 —— 预览用，让用户知道留空会得到什么 */
function previewTitle(kind: ShortcutKind, target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";
  if (kind === "url") {
    try {
      return new URL(trimmed).host.replace(/^www\./, "") || trimmed;
    } catch {
      return trimmed;
    }
  }
  const parts = trimmed.split(/[\\/]/);
  const base = parts[parts.length - 1] || trimmed;
  return base.replace(/\.(exe|lnk|bat|cmd)$/i, "") || trimmed;
}

export interface AddShortcutDialogProps {
  open: boolean;
  /** 传入表示编辑模式，不传是新增 */
  editing?: ShortcutRow | null;
  /** 从系统右键菜单唤起时带进来的目标，预填并锁定类型 */
  preset?: { kind: ShortcutKind; target: string; title: string } | null;
  onClose: () => void;
  onSubmit: (input: { kind: ShortcutKind; target: string; title?: string }) => Promise<boolean>;
  /** 新增成功且用户顺手打开了系统右键菜单时通知外层刷新开关状态 */
  onShellMenuChange?: (enabled: boolean) => void;
  shellMenuStatus?: ShellMenuStatus | null;
  shellMenuBusy?: boolean;
}

export function AddShortcutDialog({
  open,
  editing,
  preset,
  onClose,
  onSubmit,
  onShellMenuChange,
  shellMenuStatus,
  shellMenuBusy,
}: AddShortcutDialogProps) {
  const [kind, setKind] = useState<ShortcutKind>("url");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [shellEnabled, setShellEnabled] = useState(false);

  const isEdit = !!editing;

  // 每次打开都用传入值重置表单。写进 effect 而不是靠 key 重建组件：
  // 这样「编辑 A → 取消 → 打开新增」不会残留上一次的输入。
  //
  // 依赖里**不能**带 shellMenuStatus.enabled：拨动「系统右键菜单」开关会回写它，
  // 于是这个 effect 跟着重跑，把用户已经填了一半的网址/路径一起清掉。
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKind(editing.kind);
      setTarget(editing.target);
      setTitle(editing.title);
    } else if (preset) {
      setKind(preset.kind);
      setTarget(preset.target);
      setTitle(preset.title ?? "");
    } else {
      setKind("url");
      setTarget("");
      setTitle("");
    }
    setError("");
  }, [open, editing, preset]);

  // 开关状态单独跟随外部，避免与表单重置纠缠在一起
  useEffect(() => {
    setShellEnabled(shellMenuStatus?.enabled ?? false);
  }, [shellMenuStatus?.enabled]);

  const needsBrowse = kind === "app" || kind === "folder";

  const effectiveTitle = useMemo(() => title.trim() || previewTitle(kind, target), [title, kind, target]);

  const canSubmit = useMemo(() => {
    if (!target.trim()) return false;
    if (kind === "url") return /^https?:\/\/.+/i.test(target.trim());
    return true;
  }, [target, kind]);

  async function browse() {
    const picked = await window.electron.shortcutPick(kind);
    if (!picked) return;
    setTarget(picked.target);
    // 选了新路径就把标题重置成推导值：沿用上一个目标的旧名字几乎必然是错的
    setTitle("");
  }

  async function handleSubmit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError("");
    try {
      const ok = await onSubmit({ kind, target: target.trim(), title: title.trim() || undefined });
      if (ok) onClose();
      else setError("添加失败，请检查目标是否有效");
    } finally {
      setSaving(false);
    }
  }

  /** 顺手把右键菜单项也装上 —— 这是用户第一次遇到"右键里没有这一项"的地方 */
  async function toggleShellMenu(next: boolean) {
    const result = await window.electron.setShellContextMenuEnabled(next);
    if (result.success) {
      setShellEnabled(next);
      onShellMenuChange?.(next);
    } else {
      setError(result.error ?? "设置失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑快捷方式" : "添加快捷方式"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "修改名称或目标，原来的图标会自动更新" : "支持网页链接、本地程序和本地文件夹"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 类型切换 —— 编辑时锁定，改类型等于换一条记录 */}
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="快捷方式类型">
            {KIND_OPTIONS.map((option) => {
              const selected = option.value === kind;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isEdit}
                  onClick={() => {
                    setKind(option.value);
                    setTarget("");
                    setTitle("");
                    setError("");
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 border transition-all duration-200",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                    selected
                      ? "bg-primary/[0.08] border-primary/45 text-primary"
                      : "bg-card border-border text-muted-foreground hover:border-primary/25 hover:bg-primary/[0.04]"
                  )}>
                  <Icon className="h-4 w-4" />
                  <span className="text-[12px] font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-muted-foreground" htmlFor="shortcut-target">
              {kind === "url" ? "网址" : "路径"}
            </label>
            <div className="flex gap-2">
              <Input
                id="shortcut-target"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setError("");
                }}
                placeholder={
                  kind === "url" ? "https://example.com" : isEdit ? "" : "点击右侧「浏览…」选择"
                }
                readOnly={needsBrowse}
                spellCheck={false}
                className="h-8 text-[12px]"
              />
              {needsBrowse && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={browse}
                  className="h-8 shrink-0 gap-1.5 text-[12px]">
                  <FolderOpen className="h-3.5 w-3.5" />
                  浏览…
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-muted-foreground" htmlFor="shortcut-title">
              名称
              {!title.trim() && target.trim() && (
                <span className="ml-1 text-foreground/60">留空则显示「{effectiveTitle}」</span>
              )}
            </label>
            <Input
              id="shortcut-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={effectiveTitle}
              spellCheck={false}
              className="h-8 text-[12px]"
            />
          </div>

          {error && <p className="text-[11px] text-destructive leading-relaxed">{error}</p>}

          {/* 右键菜单项：只在新增时出现，且仅在当前环境支持时可选 */}
          {!isEdit && shellMenuStatus && (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              {shellMenuStatus.supported ? (
                <div className="flex items-start gap-2.5">
                  <MousePointerClick className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/70 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-foreground/85">系统右键菜单</span>
                      <Switch
                        checked={shellEnabled}
                        disabled={shellMenuBusy}
                        onCheckedChange={toggleShellMenu}
                        aria-label="系统右键菜单"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-0.5">
                      开启后，在资源管理器里右键文件或文件夹即可看到「添加到 QNote 快捷方式」
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                  系统右键菜单：{shellMenuStatus.reason}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} className="h-8 text-[12px]">
            取消
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="h-8 text-[12px] gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
