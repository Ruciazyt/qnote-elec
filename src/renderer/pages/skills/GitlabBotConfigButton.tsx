import { Check, Loader2, Radio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
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
    generateSecret,
    generateRelayToken,
    copyRelayToken,
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
        <Radio className="h-3.5 w-3.5 mr-1" />
        网关
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">
                配置 GitLab 网关
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

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">启用网关</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    关闭后不监听端口，GitLab 的 webhook 不会被接收
                  </p>
                </div>
                <Switch
                  id="gitlab-bot-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) => update({ enabled: checked })}
                  aria-label="启用网关"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="gitlab-bot-port"
                    className="text-xs font-medium text-foreground/80"
                  >
                    监听端口
                  </label>
                  <Input
                    id="gitlab-bot-port"
                    value={draft.port}
                    onChange={(e) => update({ port: e.target.value })}
                    className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="gitlab-bot-bind"
                    className="text-xs font-medium text-foreground/80"
                  >
                    监听地址
                  </label>
                  <Input
                    id="gitlab-bot-bind"
                    value={draft.bindAddress}
                    onChange={(e) => update({ bindAddress: e.target.value })}
                    placeholder="0.0.0.0"
                    className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="gitlab-bot-signing-token"
                  className="text-xs font-medium text-foreground/80"
                >
                  签名密钥
                </label>
                <div className="flex gap-2">
                  <SecretInput
                    id="gitlab-bot-signing-token"
                    value={draft.signingToken}
                    onChange={(value) => update({ signingToken: value })}
                    placeholder="whsec_ 开头；留空则沿用当前密钥"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 px-3"
                    onClick={() => void generateSecret()}
                    aria-label="生成签名密钥"
                  >
                    生成
                  </Button>
                </div>
                {draft.signingTokenHint && (
                  <p className="text-[10px] text-muted-foreground">
                    当前签名密钥：{draft.signingTokenHint}
                  </p>
                )}
                {!draft.signingTokenHint && draft.secretTokenHint && (
                  <p className="text-[10px] text-muted-foreground">
                    当前还在用旧的明文令牌模式，点「生成」切到签名模式
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="gitlab-bot-relay-token"
                  className="text-xs font-medium text-foreground/80"
                >
                  Relay 令牌
                </label>
                <div className="flex gap-2">
                  <SecretInput
                    id="gitlab-bot-relay-token"
                    value={draft.relayToken}
                    onChange={(value) => update({ relayToken: value })}
                    placeholder="qnrelay_ 开头；留空则沿用当前令牌"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 px-3"
                    onClick={() => void generateRelayToken()}
                    aria-label="生成 relay 令牌"
                  >
                    生成
                  </Button>
                </div>
                {draft.relayTokenHint && (
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-muted-foreground">
                      当前 relay 令牌：{draft.relayTokenHint}
                    </p>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-[10px]"
                      onClick={() => void copyRelayToken()}
                    >
                      复制当前令牌
                    </Button>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  自托管 Runner 领到任务后用它把原始事件转回来，GitLab
                  连不到本机时走这条路。生成的令牌要填进 GitLab 项目的 CI/CD
                  变量 QNOTE_RELAY_TOKEN
                </p>
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
                  className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                />
                <p className="text-[10px] text-muted-foreground">
                  评论里带上触发词才会唤起 agent，触发词后面的内容就是指令
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="gitlab-bot-projects"
                  className="text-xs font-medium text-foreground/80"
                >
                  允许的项目（可选）
                </label>
                <Input
                  id="gitlab-bot-projects"
                  value={draft.allowedProjects}
                  onChange={(e) => update({ allowedProjects: e.target.value })}
                  placeholder="group/project，用逗号分隔；留空表示不限制"
                  className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                />
              </div>

              <GitlabBotRunnerSection
                draft={{
                  enabled: draft.runnerEnabled,
                  project: draft.runnerProject,
                  tags: draft.runnerTags,
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
                  if (patch.tags !== undefined) {
                    update({ runnerTags: patch.tags });
                  }
                }}
                onRestart={() => void restartRunner()}
              />

              <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
                <p className="text-xs font-medium text-foreground">当前状态</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  {status?.running
                    ? `网关运行中，监听 ${status.url}`
                    : "网关未运行"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  在 GitLab 项目里加一条 webhook：地址填{" "}
                  <span className="font-mono">
                    http://&lt;本机内网 IP&gt;:{draft.port || 7799}/gitlab/webhook
                  </span>
                  ，Signing token 填上面这个签名密钥，事件勾选 Issue、Merge
                  Request 和 Note。
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <Button
                onClick={() => setOpen(false)}
                variant="outline"
                className="flex-1 h-9"
              >
                取消
              </Button>
              <Button onClick={() => void save()} disabled={saving} className="flex-1 h-9">
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
