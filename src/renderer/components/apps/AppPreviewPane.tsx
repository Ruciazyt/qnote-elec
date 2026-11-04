import { useCallback, useEffect, useRef } from "react";
import { MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setNativeViewCover } from "@/hooks/useNativeViewCover";
import { cn } from "@/lib/utils";
import type { AppProject } from "@shared/appTypes";

/**
 * 项目预览区
 *
 * 预览内容由主进程的 WebContentsView 承载 —— 它是 OS 合成器上的独立图层，
 * 永远盖在渲染进程之上，z-index 对它无效。所以这里的 div 只是一个**占位**：
 * 它的真实矩形会被同步给主进程，原生视图就摆在同一个位置。
 *
 * ## 为什么要这么绕
 *
 * 直接用 iframe 会被跨源策略拦掉（渲染层是 file:// 或 vite 的 http://localhost），
 * 直接用 file:// 又会让 `<script type="module">` 因为 CORS 失效而白屏。
 * 所以主进程给项目目录注册了 `qnote-app://` 私有协议来伺服这些文件。
 */
interface AppPreviewPaneProps {
  project: AppProject | null;
  /** 当前路由是否在前台 —— keep-alive 下切走不会卸载，只能靠这个标志隐藏原生视图 */
  active: boolean;
  /**
   * 临时收起预览
   *
   * 原生视图是 OS 合成器上的图层，永远盖在 DOM 之上，z-index 无效。
   * 所以只要有弹窗要开，就必须先把预览收起来 —— 否则对话框会被压在
   * 预览页面底下，用户点了没反应，也看不见自己点了什么。
   */
  suspended?: boolean;
  /** 预览加载失败时回调（用于弹 toast） */
  onError?: (message: string) => void;
  /**
   * 预览载入成功后回调实际地址
   *
   * 主进程会把它解析成最终的地址（http 预览原样返回，
   * 本地文件则是该文件的绝对路径）。头部要显示的是这个 ——
   * 「现在展示的页面地址」得是真实加载的那个，不能自己另算一套。
   */
  onUrlLoaded?: (projectId: number, address: string) => void;
  className?: string;
}

/** 覆盖信号里的持有者标识 —— 与浏览器页各占各的，互不覆盖 */
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

  /**
   * 错误回调放进 ref
   *
   * 父组件传进来的通常是内联箭头函数，每次渲染都是新引用。
   * 直接把它写进 effect 的依赖里会导致每次渲染都重新载入预览 ——
   * 表现为切一次页面、点一次按钮，预览就闪一下重载。
   */
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  /** 地址回调同样放进 ref —— 理由同上 */
  const onUrlLoadedRef = useRef(onUrlLoaded);
  useEffect(() => {
    onUrlLoadedRef.current = onUrlLoaded;
  }, [onUrlLoaded]);

  /**
   * 主进程推来的「预览真的加载失败」
   *
   * 只有当前展示的这个项目才提示 —— 别的项目失败不该在眼前弹窗。
   * 被取消的导航（切项目时必然发生一次）主进程不会推这个事件。
   */
  useEffect(() => {
    const off = window.electron.onAppPreviewError((payload) => {
      if (payload.projectId !== project?.id) return;
      onErrorRef.current?.(payload.message);
    });
    return () => off();
  }, [project?.id]);

  /** 把占位元素的真实矩形同步给原生视图 */
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

  /**
   * 尺寸变化时重新同步
   *
   * 侧栏折叠、窗口缩放都会改变占位区域的位置与大小，而原生视图不会跟着 DOM 走。
   * 祖先链也要观察：侧栏折叠改的是父级宽度，占位元素本身的尺寸不一定变。
   */
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

  /**
   * 切换项目时载入新的预览
   *
   * 先摆位置再载入 —— 反过来的话第一帧会落在上一个项目的位置上。
   */
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

  /**
   * 显隐跟随路由
   *
   * 页面是 keep-alive 的，切走不会卸载 —— 卸载清理不执行的话，原生视图会一直
   * 盖在整个窗口上，看起来像应用卡死。
   */
  useEffect(() => {
    const shouldShow = active && hasPreview && !suspended;
    void window.electron.appPreviewVisible(shouldShow);
    setNativeViewCover(shouldShow, COVER_OWNER);
    if (shouldShow) syncBounds();
  }, [active, hasPreview, suspended, syncBounds]);

  // 离开页面时把遮挡标记还回去
  useEffect(() => {
    return () => {
      void window.electron.appPreviewVisible(false);
      setNativeViewCover(false, COVER_OWNER);
    };
  }, []);

  return (
    <div className={cn("relative min-h-0 overflow-hidden bg-background", className)}>
      {/* 占位：原生视图就摆在它上面 */}
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
