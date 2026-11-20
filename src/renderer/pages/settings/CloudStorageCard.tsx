
import * as React from "react";
import { Cloud, Check, HelpCircle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardContent } from "@/components/ui/card";
import { ACCENTS, SettingsCard, SettingsCardHeader } from "./settings-card";
import { CatalogSetupGuide } from "./CatalogSetupGuide";
import { cn } from "@/lib/utils";
import type {
  CatalogConfig,
  CloudBackend,
  CloudConnectionStatus,
  CloudStorageConfig,
} from "@shared/cloud/cloudTypes";

const BACKEND_OPTIONS: Array<{
  value: CloudBackend;
  label: string;
  hint: string;
}> = [
  {
    value: "catalog",
    label: "公共目录",
    hint: "所有人看到同一份目录，装上就能用，不需要配置",
  },
  {
    value: "local",
    label: "仅本地",
    hint: "发布目录存在本机，换台电脑看不到",
  },
];

const EMPTY_CATALOG: CatalogConfig = {
  baseUrl: "",
  appId: "",
  publicKey: "",
  privateKey: "",
};

export function CloudStorageCard() {
  const [config, setConfig] = React.useState<CloudStorageConfig | null>(null);
  const [backend, setBackend] = React.useState<CloudBackend>("local");
  const [catalog, setCatalog] = React.useState<CatalogConfig>(EMPTY_CATALOG);
  const [status, setStatus] = React.useState<CloudConnectionStatus | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);
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
        setCatalog({
          baseUrl: loaded.catalog?.baseUrl || loaded.catalogDefaults?.baseUrl || "",
          appId: loaded.catalog?.appId || loaded.catalogDefaults?.appId || "",
          publicKey: loaded.catalog?.publicKey || "",
          privateKey: loaded.catalog?.privateKey || "",
        });
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
      const result = await window.electron.cloudTestConnection({ catalog });
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
        catalog: backend === "catalog" ? catalog : config?.catalog ?? null,
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

  const isCatalog = backend === "catalog";

  return (
    <SettingsCard accent={ACCENTS.accent}>
      <SettingsCardHeader
        accent={ACCENTS.accent}
        icon={Cloud}
        title="云端存储"
        subtitle="发布出去的 APP 目录放在哪"
        status={
          <div className="flex items-center gap-1.5">
            {isCatalog ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary-strong border border-primary/25 shrink-0">
                <Wifi className="h-3 w-3" />
                公共目录
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground border-border shrink-0">
                <WifiOff className="h-3 w-3" />
                仅本地
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setGuideOpen(true)}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5 mr-1" />
              配置指南
            </Button>
          </div>
        }
      />
      <CardContent className="px-5 pb-5 pt-0 space-y-4">
        <p className="text-[13px] text-muted-foreground/80 leading-relaxed">
          只有<strong className="text-foreground/90 font-medium">发布出去的 APP 目录</strong>
          会放上云。笔记、剪贴板、Todo、AI 对话这些你自己的数据，
          无论怎么切都留在本机。
        </p>

        <div className="space-y-2">
          <label className="text-xs font-medium text-foreground/80 block">
            存储位置
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

        {isCatalog && (
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">
                站点地址
              </label>
              <Input
                value={catalog.baseUrl}
                onChange={(e) => setCatalog({ ...catalog, baseUrl: e.target.value })}
                placeholder="https://us-west-2.data.tidbcloud.com"
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                TiDB Cloud Data Service 的区域站点，已内置，一般不用改。
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">
                App ID
              </label>
              <Input
                value={catalog.appId}
                onChange={(e) => setCatalog({ ...catalog, appId: e.target.value })}
                placeholder="Data App 的 App ID"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">
                Public Key
              </label>
              <Input
                value={catalog.publicKey}
                onChange={(e) => setCatalog({ ...catalog, publicKey: e.target.value })}
                placeholder="API Key 的 Public Key"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80 block">
                Private Key
              </label>
              <Input
                type="password"
                value={catalog.privateKey}
                onChange={(e) => setCatalog({ ...catalog, privateKey: e.target.value })}
                placeholder="API Key 的 Private Key"
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Private Key 只存在本机，不会上传到任何地方。
              </p>
            </div>
          </div>
        )}

        {isCatalog && (
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
      <CatalogSetupGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </SettingsCard>
  );
}
