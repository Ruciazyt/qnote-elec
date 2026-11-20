import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setNativeViewCover } from "@/hooks/apps/useNativeViewCover";
import { cn } from "@/lib/utils";
import type { AppProject } from "@shared/apps/appTypes";

interface AppPreviewPaneProps {
  project: AppProject | null;
  active: boolean;
  suspended?: boolean;
  reloadToken?: number;
  onUrlLoaded?: (projectId: number, address: string) => void;
  className?: string;
}

const COVER_OWNER = "apps-preview";

export function AppPreviewPane({
  project,
  active,
  suspended = false,
  reloadToken = 0,
  onUrlLoaded,
  className,
}: AppPreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPreview = Boolean(project?.preview);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [localToken, setLocalToken] = useState(0);

  const onUrlLoadedRef = useRef(onUrlLoaded);
  useEffect(() => {
    onUrlLoadedRef.current = onUrlLoaded;
  }, [onUrlLoaded]);

  useEffect(() => {
    const offError = window.electron.onAppPreviewError((payload) => {
      if (project?.id == null || payload.projectId !== project.id) return;
      setError(payload.message);
      setReloading(false);
    });
    const offLoaded = window.electron.onAppPreviewLoaded((payload) => {
      if (project?.id == null || payload.projectId !== project.id) return;
      setError(null);
      setReloading(false);
    });
    return () => {
      offError();
      offLoaded();
    };
  }, [project?.id]);

  const syncBounds = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    void window.electron.appPreviewBounds({
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
  }, [project?.id]);

  useEffect(() => {
    if (!project?.preview) return;
    syncBounds();
    let cancelled = false;
    setReloading(true);
    void (async () => {
      try {
        const res = await window.electron.appPreviewLoad(project.id);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error ?? "预览加载失败");
          setReloading(false);
        } else if (res.display) {
          onUrlLoadedRef.current?.(project.id, res.display);
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
  }, [project?.id, project?.preview, reloadToken, localToken, syncBounds]);

  useEffect(() => {
    const shouldShow = active && hasPreview && !suspended && !error;
    void window.electron.appPreviewVisible(shouldShow);
    setNativeViewCover(shouldShow, COVER_OWNER);
    if (shouldShow) syncBounds();
  }, [active, hasPreview, suspended, error, syncBounds]);

  useEffect(() => {
    return () => {
      void window.electron.appPreviewVisible(false);
      setNativeViewCover(false, COVER_OWNER);
    };
  }, []);

  return (
    <div className={cn("relative min-h-0 overflow-hidden bg-background", className)}>
      {}
      <div ref={containerRef} className="absolute inset-0" />

      {!hasPreview && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
          <MonitorPlay className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/70">该项目没有配置预览页面</p>
          <p className="text-xs text-muted-foreground/50">
            在 qnote.json 里填一个 <code className="font-mono">preview</code> 就能在这里看到它
          </p>
        </div>
      )}

      {hasPreview && error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-center px-6">
          <WifiOff className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/80">预览加载失败</p>
          <p className="text-xs text-muted-foreground/60 max-w-[360px] leading-relaxed">{error}</p>
          <p className="text-xs text-muted-foreground/50">服务起来之后点下面这个按钮重载</p>
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
