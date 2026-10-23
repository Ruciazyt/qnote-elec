import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Button } from "../ui/button";
import { CardContent } from "../ui/card";
import { Progress } from "../ui/progress";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ACCENTS, SettingsCard, SettingsCardHeader } from "./settings-card";
import type { UpdateStatus } from "@/types/update";

/**
 * 应用更新卡片
 *
 * 覆盖完整的「检查 → 下载 → 安装」链路：
 *   - 检查：比对 GitHub Releases 上的最新版本
 *   - 下载：带进度条与速度显示
 *   - 安装：静默安装并自动重启应用
 *
 * 状态由主进程单方面推进（core/updater.ts），渲染层只负责展示。
 * 进度这类高频事件走 update:status 推送，不走 IPC 的返回值。
 */

/** 字节数 → 人类可读 */
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 状态 → 徽章文案与配色 */
function describeStatus(status: UpdateStatus): {
  label: string;
  className: string;
} {
  switch (status.phase) {
    case "checking":
      return {
        label: "检查中",
        className: "bg-muted text-muted-foreground border-border",
      };
    case "available":
      return {
        label: `新版本 v${status.latestVersion ?? "?"}`,
        className: "bg-primary/10 text-primary border-primary/25",
      };
    case "not-available":
      return {
        label: "已是最新",
        className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      };
    case "downloading":
      return {
        label: `下载中 ${status.percent ?? 0}%`,
        className: "bg-primary/10 text-primary border-primary/25",
      };
    case "downloaded":
      return {
        label: "待安装",
        className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      };
    case "error":
      return {
        label: "更新失败",
        className: "bg-destructive/10 text-destructive border-destructive/30",
      };
    case "unsupported":
      return {
        label: "不支持",
        className: "bg-muted text-muted-foreground border-border",
      };
    default:
      return {
        label: `v${status.currentVersion}`,
        className: "bg-muted text-muted-foreground border-border",
      };
  }
}

/** 状态 → 卡片里那句说明文字 */
function describeDetail(status: UpdateStatus): string {
  switch (status.phase) {
    case "checking":
      return "正在连接更新服务器…";
    case "available":
      return `发现新版本 v${status.latestVersion ?? "?"}，下载后重启即可完成更新。`;
    case "not-available":
      return `当前 v${status.currentVersion} 已是最新版本。`;
    case "downloading": {
      const size = formatBytes(status.total);
      const speed = formatBytes(status.bytesPerSecond);
      const parts = [`正在下载更新包 ${status.percent ?? 0}%`];
      if (size) parts.push(size);
      if (speed) parts.push(`${speed}/s`);
      return parts.join(" · ");
    }
    case "downloaded":
      return "更新包已就绪，重启应用即可完成安装。";
    case "error":
      return status.error || "更新过程中出现问题，请稍后重试。";
    case "unsupported":
      return status.reason || "当前环境不支持自动更新。";
    default:
      return `当前版本 v${status.currentVersion}。检查更新会联网查询最新版本。`;
  }
}

export function UpdateCard() {
  const [status, setStatus] = useState<UpdateStatus>({
    phase: "idle",
    currentVersion: "-",
  });
  const [busy, setBusy] = useState(false);
  /** 是否支持自动更新 —— 便携版与开发模式为 false */
  const [supported, setSupported] = useState(true);

  // 订阅主进程推送的状态
  useEffect(() => {
    let dispose: (() => void) | undefined;
    try {
      dispose = window.electron.onUpdateStatus((next) => {
        setStatus(next);
      });
    } catch (err) {
      console.error("订阅更新状态失败:", err);
    }
    return () => dispose?.();
  }, []);

  // 拉一次当前状态与环境信息
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [current, env] = await Promise.all([
          window.electron.getUpdateStatus(),
          window.electron.getUpdateEnvironment(),
        ]);
        if (cancelled) return;
        setStatus(current);
        setSupported(env.packaged && !env.portable);
      } catch (err) {
        console.error("读取更新状态失败:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheck = useCallback(async () => {
    setBusy(true);
    try {
      const next = await window.electron.checkForUpdate();
      setStatus(next);
      if (next.phase === "not-available") {
        toast({ title: "已是最新版本", description: `当前 v${next.currentVersion}` });
      } else if (next.phase === "available") {
        toast({
          title: "发现新版本",
          description: `v${next.latestVersion} 可下载`,
        });
      } else if (next.phase === "error") {
        toast({
          title: "检查更新失败",
          description: next.error,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("检查更新失败:", err);
      toast({ title: "检查更新失败", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    setBusy(true);
    try {
      const next = await window.electron.downloadUpdate();
      setStatus(next);
      if (next.phase === "error") {
        toast({
          title: "下载更新失败",
          description: next.error,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("下载更新失败:", err);
      toast({ title: "下载更新失败", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    setBusy(true);
    try {
      const result = await window.electron.installUpdate();
      if (!result.ok) {
        toast({
          title: "无法开始安装",
          description: result.error,
          variant: "destructive",
        });
        setBusy(false);
      }
      // 成功的话应用会退出，这里不再恢复按钮状态
    } catch (err) {
      console.error("安装更新失败:", err);
      toast({ title: "安装更新失败", description: String(err), variant: "destructive" });
      setBusy(false);
    }
  }, []);

  const handleOpenReleases = useCallback(async () => {
    try {
      await window.electron.openReleasesPage();
    } catch (err) {
      console.error("打开下载页面失败:", err);
      toast({ title: "打开下载页面失败", description: String(err), variant: "destructive" });
    }
  }, []);

  const badge = describeStatus(status);
  const detail = describeDetail(status);

  // 主按钮：按当前状态决定是"检查"还是"下载"还是"安装"
  const isChecking = status.phase === "checking";
  const isDownloading = status.phase === "downloading";
  const isDownloaded = status.phase === "downloaded";
  // 注意：按钮不禁用"当前环境不支持自动更新"的情况。
  // 主进程会返回具体原因（开发模式 / 便携版 / 更新源不可达），
  // 让用户点一下就能看到解释，比一个点不动的按钮有用得多。
  const canCheck = !busy && !isChecking && !isDownloading && !isDownloaded;
  const canDownload = status.phase === "available" && !busy;

  return (
    <SettingsCard accent={ACCENTS.neutral}>
      <SettingsCardHeader
        accent={ACCENTS.neutral}
        icon={RefreshCw}
        title="应用更新"
        subtitle="检查新版本，下载并完成安装"
        status={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border shrink-0",
              badge.className
            )}
          >
            {badge.label}
          </span>
        }
      />
      <CardContent className="px-5 pb-5 pt-0">
        <div className="space-y-3">
          {/* 状态说明 */}
          <div className="flex items-start gap-2">
            {status.phase === "error" ? (
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            ) : status.phase === "not-available" || isDownloaded ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
            ) : (
              <RefreshCw className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              {detail}
            </p>
          </div>

          {/* 下载进度条 */}
          {isDownloading && (
            <div className="space-y-1.5">
              <Progress value={status.percent ?? 0} />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground/70">
                <span>
                  {formatBytes(status.transferred)}
                  {status.total ? ` / ${formatBytes(status.total)}` : ""}
                </span>
                <span>{status.percent ?? 0}%</span>
              </div>
            </div>
          )}

          {/* 更新说明 */}
          {(status.phase === "available" || isDownloaded) && status.releaseNotes && (
            <details className="group rounded-lg border border-border/70 bg-muted/30">
              <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-foreground/85">
                更新内容
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground">
                {status.releaseNotes}
              </pre>
            </details>
          )}

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-2">
            {isDownloaded ? (
              <Button
                onClick={handleInstall}
                disabled={busy}
                className="w-full h-9 btn-hover sm:w-auto">
                <RotateCcw className="h-4 w-4 mr-1.5" />
                重启并安装
              </Button>
            ) : status.phase === "available" ? (
              <Button
                onClick={handleDownload}
                disabled={!canDownload}
                className="w-full h-9 btn-hover sm:w-auto">
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1.5" />
                )}
                下载更新
              </Button>
            ) : (
              <Button
                onClick={handleCheck}
                disabled={!canCheck}
                variant="outline"
                className="w-full h-9 btn-hover sm:w-auto">
                {isChecking || busy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <ArrowUpCircle className="h-4 w-4 mr-1.5" />
                )}
                {isChecking ? "检查中…" : "检查更新"}
              </Button>
            )}

            {/* 手动下载出口：自动更新不可用或失败时的兜底 */}
            <Button
              onClick={handleOpenReleases}
              variant="ghost"
              className="w-full h-9 btn-hover sm:w-auto">
              <ExternalLink className="h-4 w-4 mr-1.5" />
              打开下载页
            </Button>
          </div>

          {/* 便携版 / 开发模式的常驻说明 */}
          {!supported && (
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              {status.phase === "unsupported" && status.reason
                ? status.reason
                : "当前运行环境不支持自动更新，可通过下载页手动获取新版本。"}
            </p>
          )}
        </div>
      </CardContent>
    </SettingsCard>
  );
}
