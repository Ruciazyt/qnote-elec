import { useCallback, useEffect, useRef } from "react";
import { MonitorPlay } from "lucide-react";
import { setNativeViewCover } from "@/hooks/apps/useNativeViewCover";
import { cn } from "@/lib/utils";
import type { AppProject } from "@shared/apps/appTypes";

interface AppPreviewPaneProps {
  project: AppProject | null;
  active: boolean;
  suspended?: boolean;
  onError?: (message: string) => void;
  onUrlLoaded?: (projectId: number, address: string) => void;
  className?: string;
}

const COVER_OWNER = "apps-preview";

export function AppPreviewPane({
  project,
  active,
  suspended = false,
  onError,
  onUrlLoaded,
  className,
}: AppPreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPreview = Boolean(project?.preview);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const onUrlLoadedRef = useRef(onUrlLoaded);
  useEffect(() => {
    onUrlLoadedRef.current = onUrlLoaded;
  }, [onUrlLoaded]);

  useEffect(() => {
    const off = window.electron.onAppPreviewError((payload) => {
      if (payload.projectId !== project?.id) return;
      onErrorRef.current?.(payload.message);
    });
    return () => off();
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
    if (!project?.preview) return;
    syncBounds();
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.electron.appPreviewLoad(project.id);
        if (cancelled) return;
        if (!res.ok) {
          onErrorRef.current?.(res.error ?? "预览加载失败");
        } else if (res.display) {
          onUrlLoadedRef.current?.(project.id, res.display);
        }
      } catch (err) {
        if (!cancelled) onErrorRef.current?.(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.preview, syncBounds]);

  useEffect(() => {
    const shouldShow = active && hasPreview && !suspended;
    void window.electron.appPreviewVisible(shouldShow);
    setNativeViewCover(shouldShow, COVER_OWNER);
    if (shouldShow) syncBounds();
  }, [active, hasPreview, suspended, syncBounds]);

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
    </div>
  );
}
