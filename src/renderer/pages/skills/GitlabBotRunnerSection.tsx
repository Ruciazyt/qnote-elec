import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { GitlabRunnerStatusView } from "@shared/ai/gitlabBot";

export interface GitlabBotRunnerDraft {
  enabled: boolean;
  project: string;
}

interface GitlabBotRunnerSectionProps {
  draft: GitlabBotRunnerDraft;
  status: GitlabRunnerStatusView | null;
  restarting: boolean;
  onChange: (patch: Partial<GitlabBotRunnerDraft>) => void;
  onRestart: () => void;
}

export default function GitlabBotRunnerSection({
  draft,
  status,
  restarting,
  onChange,
  onRestart,
}: GitlabBotRunnerSectionProps) {
  const running = status?.running ?? false;
  const stateText = !status
    ? "Runner 状态未知"
    : running
      ? `Runner 运行中（PID ${status.pid}）`
      : status.lastError
        ? `Runner 未运行：${status.lastError}`
        : "Runner 未运行";

  return (
    <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">自托管 Runner</p>
          <p className="text-xs text-muted-foreground mt-1">
            由 QNote 管理生命周期，接收流水线任务并转发事件。
          </p>
        </div>
        <Switch
          id="gitlab-bot-runner-enabled"
          checked={draft.enabled}
          onCheckedChange={(checked) => onChange({ enabled: checked })}
          aria-label="启用 Runner"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="gitlab-bot-runner-project"
          className="text-xs font-medium text-foreground/80"
        >
          绑定项目
        </label>
        <Input
          id="gitlab-bot-runner-project"
          value={draft.project}
          onChange={(e) => onChange({ project: e.target.value })}
          placeholder="group/project"
          className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
        />
        <p className="text-xs text-muted-foreground">
          留空时使用项目白名单中的首个项目。
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {stateText}
          {status?.restarts ? ` · 已自动重启 ${status.restarts} 次` : ""}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-[11px]"
          onClick={onRestart}
          disabled={restarting}
          aria-label="重启 Runner"
        >
          {restarting ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
          )}
          重启
        </Button>
      </div>
    </div>
  );
}
