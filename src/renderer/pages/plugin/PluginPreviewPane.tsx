import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setNativeViewCover } from "@/hooks/plugin/useNativeViewCover";
import { cn } from "@/lib/utils";
import type { PluginRecord } from "@shared/plugin/pluginTypes";

interface PluginPreviewPaneProps {
  plugin: PluginRecord | null;
  active: boolean;
  suspended?: boolean;
  reloadToken?: number;
  onUrlLoaded?: (localId: number, address: string) => void;
  className?: string;
}

const COVER_OWNER = "plugin-preview";

export function PluginPreviewPane({
  plugin,
  active,
  suspended = false,
  reloadToken = 0,
  onUrlLoaded,
  className,
}: PluginPreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPreview = Boolean(plugin?.preview);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [localToken, setLocalToken] = useState(0);

  const localId = plugin?.localId ?? null;

  const onUrlLoadedRef = useRef(onUrlLoaded);
  useEffect(() => {
    onUrlLoadedRef.current = onUrlLoaded;
  }, [onUrlLoaded]);

  useEffect(() => {
    const offError = window.electron.onPluginPreviewError((payload) => {
      if (localId == null || payload.localId !== localId) return;
      setError(payload.message);
      setReloading(false);
    });
    const offLoaded = window.electron.onPluginPreviewLoaded((payload) => {
      if (localId == null || payload.localId !== localId) return;
      setError(null);
      setReloading(false);
    });
    return () => {
      offError();
      offLoaded();
    };
  }, [localId]);

  const syncBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    void window.electron.pluginPreviewBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(el);
    let node: HTMLElement | null = el.parentElement;
    while (node && node !== document.body) {
      observer.observe(node);
      node = node.parentElement;
    }

    window.addEventListener("resize", syncBounds);
    syncBounds();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [syncBounds]);

  useEffect(() => {
    setError(null);
    setReloading(false);
  }, [localId]);

  useEffect(() => {
    if (localId == null || !plugin?.preview) return;
    syncBounds();
    let cancelled = false;
    setReloading(true);
    void (async () => {
      try {
        const res = await window.electron.pluginPreviewLoad(localId);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error ?? "预览加载失败");
          setReloading(false);
        } else if (res.display) {
          onUrlLoadedRef.current?.(localId, res.display);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setReloading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localId, plugin?.preview, reloadToken, localToken, syncBounds]);

  useEffect(() => {
    const shouldShow = active && hasPreview && !suspended && !error;
    void window.electron.pluginPreviewVisible(shouldShow);
    setNativeViewCover(shouldShow, COVER_OWNER);
    if (shouldShow) syncBounds();
  }, [active, hasPreview, suspended, error, syncBounds]);

  useEffect(() => {
    return () => {
      void window.electron.pluginPreviewVisible(false);
      setNativeViewCover(false, COVER_OWNER);
    };
  }, []);

  return (
    <div className={cn("relative min-h-0 overflow-hidden bg-background", className)}>
      <div ref={containerRef} className="absolute inset-0" />

      {!hasPreview && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
          <MonitorPlay className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">这个插件没有配置预览页面</p>
          <p className="text-xs text-muted-foreground">
            在 plugin.json 里填一个 <code className="font-mono">runtime.preview</code>{" "}
            就能在这里看到它
          </p>
        </div>
      )}

      {hasPreview && error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-center px-6">
          <WifiOff className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-foreground">预览加载失败</p>
          <p className="text-xs text-muted-foreground max-w-[360px] leading-relaxed">{error}</p>
          <p className="text-xs text-muted-foreground">服务起来之后点下面这个按钮重载</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs btn-hover"
            onClick={() => setLocalToken((token) => token + 1)}
            disabled={reloading}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1", reloading && "animate-spin")} />
            {reloading ? "正在刷新" : "刷新预览"}
          </Button>
        </div>
      )}
    </div>
  );
}
