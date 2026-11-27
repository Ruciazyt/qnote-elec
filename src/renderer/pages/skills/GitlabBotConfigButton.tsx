import { Check, Loader2, Radio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import GitlabBotRunnerSection from "./GitlabBotRunnerSection";
import { useGitlabBotConfig } from "./useGitlabBotConfig";

export default function GitlabBotConfigButton() {
  const {
    open,
    setOpen,
    draft,
    update,
    status,
    runner,
    saving,
    openDialog,
    restartRunner,
    save,
  } = useGitlabBotConfig();

  return (
    <>
      <Button
        variant="ghost"
        className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => void openDialog()}
        aria-label="配置 GitLab 网关"
      >
        <Radio className="mr-1 h-3.5 w-3.5" />
        网关
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                GitLab 网关
              </h2>
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

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    启用网关
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Relay 仅监听本机地址 127.0.0.1。
                  </p>
                </div>
                <Switch
                  id="gitlab-bot-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) => update({ enabled: checked })}
                  aria-label="启用网关"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="gitlab-bot-words"
                  className="text-xs font-medium text-foreground/80"
                >
                  触发词
                </label>
                <Input
                  id="gitlab-bot-words"
                  value={draft.triggerWords}
                  onChange={(e) => update({ triggerWords: e.target.value })}
                  placeholder="@qnote"
                  className="h-9 bg-muted/30 font-mono text-xs focus-visible:bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  触发词后的文本作为任务指令。
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="gitlab-bot-projects"
                  className="text-xs font-medium text-foreground/80"
                >
                  项目白名单
                </label>
                <Input
                  id="gitlab-bot-projects"
                  value={draft.allowedProjects}
                  onChange={(e) => update({ allowedProjects: e.target.value })}
                  placeholder="group/project，逗号分隔；留空表示不限制"
                  className="h-9 bg-muted/30 font-mono text-xs focus-visible:bg-background"
                />
              </div>

              <GitlabBotRunnerSection
                draft={{
                  enabled: draft.runnerEnabled,
                  project: draft.runnerProject,
                }}
                status={runner}
                restarting={saving}
                onChange={(patch) => {
                  if (patch.enabled !== undefined) {
                    update({ runnerEnabled: patch.enabled });
                  }
                  if (patch.project !== undefined) {
                    update({ runnerProject: patch.project });
                  }
                }}
                onRestart={() => void restartRunner()}
              />

              <div
                className={`rounded-lg border-l-4 p-3 ${
                  status?.running
                    ? "border-emerald-500 bg-emerald-500/5"
                    : "border-muted-foreground/30 bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    网关状态
                  </p>
                  <span
                    className={`text-xs font-medium ${
                      status?.running
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {status?.running ? "运行中" : "已停止"}
                  </span>
                </div>
                {status?.running && status.url && (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    Relay：{status.url}/gitlab/relay
                  </p>
                )}
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="text-xs font-semibold text-foreground">
                    接入方式
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    使用 Agent 执行 gitlab_ensure_runner，并将生成的 CI 配置提交至项目。
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <Button
                onClick={() => setOpen(false)}
                variant="outline"
                className="h-9 flex-1"
              >
                取消
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving}
                className="h-9 flex-1"
              >
                {saving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
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
