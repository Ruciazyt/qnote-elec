import { useState } from "react";
import { Check, Loader2, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/ui/use-toast";

interface Draft {
  baseUrl: string;
  token: string;
  allowedProjects: string;
  readOnly: boolean;
  expectedVersion: string;
  tokenHint: string;
}

const EMPTY_DRAFT: Draft = {
  baseUrl: "",
  token: "",
  allowedProjects: "",
  readOnly: false,
  expectedVersion: "",
  tokenHint: "",
};

export default function GitlabConfigButton({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const handleOpen = async () => {
    try {
      const cfg = await window.electron.getGitlabConfig();
      setDraft({
        baseUrl: cfg.baseUrl,
        token: "",
        allowedProjects: cfg.allowedProjects.join(", "),
        readOnly: cfg.readOnly,
        expectedVersion: cfg.expectedVersion ?? "",
        tokenHint: cfg.tokenHint,
      });
      setOpen(true);
    } catch {
      toast({ title: "读取配置失败", description: "无法获取 GitLab 配置", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.electron.saveGitlabConfig({
        baseUrl: draft.baseUrl.trim(),
        token: draft.token.trim() || undefined,
        allowedProjects: draft.allowedProjects
          .split(/[,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        readOnly: draft.readOnly,
        expectedVersion: draft.expectedVersion.trim() || null,
      });
      if (!result.success) {
        toast({ title: result.error || "保存失败", variant: "destructive" });
        return;
      }
      toast({ title: "GitLab 配置已保存" });
      setOpen(false);
      onSaved();
    } catch {
      toast({ title: "保存失败", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const result = await window.electron.clearGitlabConfig();
      if (!result.success) {
        toast({ title: result.error || "清除失败", variant: "destructive" });
        return;
      }
      toast({ title: "已清除本机配置" });
      setOpen(false);
      onSaved();
    } catch {
      toast({ title: "清除失败", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => void handleOpen()}
        aria-label="配置 GitLab"
      >
        <Settings2 className="h-3.5 w-3.5 mr-1" />
        配置
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">配置 GitLab</h2>
              <Button
                onClick={() => setOpen(false)}
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="gitlab-base-url" className="text-xs font-medium text-foreground/80">
                  实例地址
                </label>
                <Input
                  id="gitlab-base-url"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://gitlab.example.com"
                  className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="gitlab-token" className="text-xs font-medium text-foreground/80">
                  访问令牌
                </label>
                <SecretInput
                  id="gitlab-token"
                  value={draft.token}
                  onChange={(value) => setDraft({ ...draft, token: value })}
                  placeholder="留空则沿用当前令牌"
                />
                {draft.tokenHint && (
                  <p className="text-[10px] text-muted-foreground">
                    当前令牌：{draft.tokenHint}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="gitlab-allowed-projects"
                  className="text-xs font-medium text-foreground/80"
                >
                  允许的项目（可选）
                </label>
                <Input
                  id="gitlab-allowed-projects"
                  value={draft.allowedProjects}
                  onChange={(e) => setDraft({ ...draft, allowedProjects: e.target.value })}
                  placeholder="group/project，用逗号分隔；留空表示不限制"
                  className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="gitlab-expected-version"
                  className="text-xs font-medium text-foreground/80"
                >
                  期望版本（可选）
                </label>
                <Input
                  id="gitlab-expected-version"
                  value={draft.expectedVersion}
                  onChange={(e) => setDraft({ ...draft, expectedVersion: e.target.value })}
                  placeholder="19.2"
                  className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                />
              </div>

              <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">只读模式</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    打开后所有写操作会被阻断，只保留查询类工具
                  </p>
                </div>
                <Switch
                  id="gitlab-read-only"
                  checked={draft.readOnly}
                  onCheckedChange={(checked) => setDraft({ ...draft, readOnly: checked })}
                  aria-label="只读模式"
                />
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                配置保存在本机数据库里，令牌不会外发；清空后回退到环境变量
                GITLAB_BASE_URL / GITLAB_TOKEN 的取值。
              </p>
            </div>

            <div className="flex gap-2 mt-5">
              <Button
                onClick={() => void handleClear()}
                disabled={saving}
                variant="ghost"
                className="h-9 px-2.5 text-muted-foreground hover:text-destructive"
                aria-label="清除配置"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => setOpen(false)}
                variant="outline"
                className="flex-1 h-9"
              >
                取消
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving} className="flex-1 h-9">
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1.5" />
                )}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
