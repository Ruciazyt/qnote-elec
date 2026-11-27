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
  allowedRepositories: string;
  readOnly: boolean;
  tokenHint: string;
}

const EMPTY_DRAFT: Draft = {
  baseUrl: "",
  token: "",
  allowedRepositories: "",
  readOnly: false,
  tokenHint: "",
};

export default function GithubConfigButton({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const handleOpen = async () => {
    try {
      const cfg = await window.electron.getGithubConfig();
      setDraft({
        baseUrl: cfg.baseUrl,
        token: "",
        allowedRepositories: cfg.allowedRepositories.join(", "),
        readOnly: cfg.readOnly,
        tokenHint: cfg.tokenHint,
      });
      setOpen(true);
    } catch {
      toast({ title: "读取配置失败", description: "无法获取 GitHub 配置", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.electron.saveGithubConfig({
        baseUrl: draft.baseUrl.trim(),
        token: draft.token.trim() || undefined,
        allowedRepositories: draft.allowedRepositories
          .split(/[,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        readOnly: draft.readOnly,
      });
      if (!result.success) {
        toast({ title: result.error || "保存失败", variant: "destructive" });
        return;
      }
      toast({ title: "GitHub 配置已保存" });
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
      const result = await window.electron.clearGithubConfig();
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
        aria-label="配置 GitHub"
      >
        <Settings2 className="h-3.5 w-3.5 mr-1" />
        配置
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">配置 GitHub</h2>
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
                <label htmlFor="github-base-url" className="text-xs font-medium text-foreground/80">
                  API 地址
                </label>
                <Input
                  id="github-base-url"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://api.github.com"
                  className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                />
                <p className="text-[10px] text-muted-foreground">
                  公有实例用 https://api.github.com；GitHub Enterprise Server 填
                  https://&lt;主机&gt;/api/v3
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="github-token" className="text-xs font-medium text-foreground/80">
                  访问令牌
                </label>
                <SecretInput
                  id="github-token"
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
                  htmlFor="github-allowed-repositories"
                  className="text-xs font-medium text-foreground/80"
                >
                  允许的仓库（可选）
                </label>
                <Input
                  id="github-allowed-repositories"
                  value={draft.allowedRepositories}
                  onChange={(e) => setDraft({ ...draft, allowedRepositories: e.target.value })}
                  placeholder="owner/repo，用逗号分隔；留空表示不限制"
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
                  id="github-read-only"
                  checked={draft.readOnly}
                  onCheckedChange={(checked) => setDraft({ ...draft, readOnly: checked })}
                  aria-label="只读模式"
                />
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                配置保存在本机数据库里，令牌不会外发；清空后回退到环境变量
                GITHUB_BASE_URL / GITHUB_TOKEN 的取值。
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
