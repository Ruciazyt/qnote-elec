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
} from "@shared/apps/appRisk";
import type { StartConfirmation } from "@shared/apps/appTypes";

interface StartConfirmDialogProps {
  open: boolean;
  confirmation: StartConfirmation | null;
  onClose: () => void;
  onConfirm: (manifestHash: string) => void;
}

export function StartConfirmDialog({
  open,
  confirmation,
  onClose,
  onConfirm,
}: StartConfirmDialogProps) {
  const [acknowledged, setAcknowledged] = React.useState(false);

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

        {
}
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

        {}
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

        {}
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
