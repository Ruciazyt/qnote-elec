import * as React from "react";
import { Cloud, Check, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardContent } from "@/components/ui/card";
import { ACCENTS, SettingsCard, SettingsCardHeader } from "./settings-card";
import { cn } from "@/lib/utils";
import type {
  CloudBackend,
  CloudConnectionStatus,
  CloudStorageConfig,
  D1Config,
} from "@shared/cloud/cloudTypes";


const BACKEND_OPTIONS: Array<{
  value: CloudBackend;
  label: string;
  hint: string;
}> = [
  {
    value: "public",
    label: "公共目录",
    hint: "所有人看到同一份目录，装上就能用，不需要配置",
  },
  {
    value: "d1",
    label: "自建 D1",
    hint: "连你自己的 Cloudflare D1 库，需要填账号 ID、库 ID 与 Token",
  },
  {
    value: "local",
    label: "仅本地",
    hint: "发布目录存在本机，换台电脑看不到",
  },
];

export function CloudStorageCard() {
  const [config, setConfig] = React.useState<CloudStorageConfig | null>(null);
  const [backend, setBackend] = React.useState<CloudBackend>("public");
  const [d1, setD1] = React.useState<D1Config>({
    accountId: "",
    databaseId: "",
    apiToken: "",
  });
  const [endpoint, setEndpoint] = React.useState("");
  const [status, setStatus] = React.useState<CloudConnectionStatus | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const loaded = await window.electron.cloudGetConfig();
        if (!alive) return;
        setConfig(loaded);
        setBackend(loaded.backend);
        if (loaded.d1) setD1(loaded.d1);
        setEndpoint(loaded.endpoint ?? "");
        if (loaded.lastCheck) setStatus(loaded.lastCheck);
      } catch (err) {
        console.error("读取云端配置失败", err);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleTest = async () => {
    setChecking(true);
    setError(null);
    setStatus(null);
    try {
      const result = await window.electron.cloudTestConnection({
        ...(backend === "public" ? { endpoint: endpoint.trim() } : { d1 }),
      });
      setStatus(result);
      if (!result.ok) setError(result.error ?? "连接失败");
    } catch (err) {
      console.error("测试连接失败", err);
      setError("测试连接失败，请稍后重试");
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await window.electron.cloudSaveConfig({
        backend,
        d1: backend === "d1" ? d1 : config?.d1 ?? null,
        endpoint: backend === "public" ? endpoint.trim() : config?.endpoint ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfig(result.data);
      setStatus(result.data.lastCheck ?? null);
    } catch (err) {
      console.error("保存云端配置失败", err);
      setError("保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const isPublic = backend === "public";
  const isD1 = backend === "d1";

  return (
    <SettingsCard accent={ACCENTS.accent}>
      <SettingsCardHeader
        accent={ACCENTS.accent}
        icon={Cloud}
        title="云端存储"
        subtitle="发布出去的 APP 目录放在哪"
        status={
          isPublic ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary-strong border border-primary/25 shrink-0">
              <Wifi className="h-3 w-3" />
              公共目录
            </span>
          ) : isD1 ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary-strong border border-primary/25 shrink-0">
              <Wifi className="h-3 w-3" />
              自建 D1
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground border-border shrink-0">
              <WifiOff className="h-3 w-3" />
              仅本地
            </span>
          )
        }
      />
      <CardContent className="px-5 pb-5 pt-0 space-y-4">
        {}
        <p className="text-[13px] text-muted-foreground/80 leading-relaxed">
          只有<strong className="text-foreground/90 font-medium">发布出去的 APP 目录</strong>
          会放上云。笔记、剪贴板、Todo、AI 对话这些你自己的数据，
          无论怎么切都留在本机。
        </p>

        {}
        <div className="space-y-2">
          <label className="text-xs font-medium text-foreground/80 block">
            存储位置
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {BACKEND_OPTIONS.map((option) => {
              const active = backend === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBackend(option.value)}
                  aria-pressed={active}
                  className={cn(
                    "text-left rounded-lg border px-3 py-2.5 transition-colors",
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/70 hover:border-muted-foreground/30"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    <span
                      className={cn(
                        "text-[13px] font-medium",
                        active ? "text-foreground" : "text-foreground/85"
                      )}
                    >
                      {option.label}
                    </span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground/70 leading-relaxed mt-1">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {}
        {isPublic && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80 block">
              公共目录地址
            </label>
            <Input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://qnote-catalog.<你的子域>.workers.dev"
              className="h-9 text-xs"
            />
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              这个地址是公开的（不是密钥），正式版已经内置好了。
              留空就用构建时注入的那个。
            </p>
          </div>
        )}

        {}
        {isD1 && (
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">
                Cloudflare 账号 ID
              </label>
              <Input
                value={d1.accountId}
                onChange={(e) => setD1({ ...d1, accountId: e.target.value })}
                placeholder="Cloudflare 控制台右侧的 Account ID"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">
                D1 数据库 ID
              </label>
              <Input
                value={d1.databaseId}
                onChange={(e) => setD1({ ...d1, databaseId: e.target.value })}
                placeholder="wrangler d1 list 里的 database_id"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">
                API Token
              </label>
              <Input
                type="password"
                value={d1.apiToken}
                onChange={(e) => setD1({ ...d1, apiToken: e.target.value })}
                placeholder="需要 D1 Read + D1 Write 权限"
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Token 只存在本机，不会上传到任何地方 —— 它直接用于访问你自己的 D1 库。
              </p>
            </div>
          </div>
        )}

        {}
        {(isPublic || isD1) && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleTest}
              disabled={checking}
              variant="outline"
              className="h-8 text-xs"
            >
              {checking ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Wifi className="h-3.5 w-3.5 mr-1.5" />
              )}
              {checking ? "测试中..." : "测试连接"}
            </Button>
            {status?.ok && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                {status.detail ?? "连接正常"}
              </span>
            )}
          </div>
        )}

        {}
        {error && (
          <p className="text-[12px] text-destructive leading-relaxed" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-9 btn-hover"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            {saving ? "保存中..." : "保存"}
          </Button>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            切到云端前会先测一次连接，通不过就不会切。
          </p>
        </div>
      </CardContent>
    </SettingsCard>
  );
}
