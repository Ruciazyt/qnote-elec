import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Code2, ExternalLink, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NoteFileEntry } from "../../../../shared/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";
import { cn } from "@/lib/utils";

interface HtmlViewerProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
}

/**
 * HTML 笔记查看器 —— 「预览 / 源码」双模式。
 *
 * 预览模式用沙箱 iframe 渲染，来源是主进程注册的 qnote-note:// 协议：
 *   - 协议只服务笔记目录内的 .html 文件，路径越界由主进程 resolveSafe 拒绝
 *   - sandbox 不含 allow-same-origin：iframe 内的脚本拿不到同源特权，
 *     也碰不到宿主的 preload API。一旦放开 allow-same-origin，
 *     笔记里的脚本就能顺着 parent爬进应用。
 *   - 不放开 allow-top-navigation：避免笔记内容劫持窗口跳转。
 *
 * 源码模式是纯文本编辑，走 notes:write-html 落盘（内嵌 dataUrl 图片
 * 由主进程抽进 assets/），因此本页其实是可编辑的，save 不是永远返回 false。
 *
 * ## 为什么预览走 qnote-note:// 协议而不是 srcDoc
 *
 * 两条老路都有硬伤：
 *   - **file://** —— 开发环境渲染层跑在 http://localhost，主窗口开着
 *     webSecurity，file:// 子资源会被整个拦掉，表现为空白且不报错。
 *   - **srcDoc** —— Chromium 内部把 srcDoc 当 data: URL 处理，于是
 *     data: URL 的限制全部落到笔记上：锚点导航不被支持（点击页内锚点会
 *     触发 AllowContentInitiatedDataUrlNavigations 安全检查，控制台刷
 *     "Hit debug scenario: 4"），脚本也拿不到正常的同源环境。
 *
 * 自定义协议被Chromium 视作安全来源，两种环境下行为一致，锚点、表单、
 * 脚本都能正常工作。协议负责「从哪加载」，sandbox 负责「加载后能干什么」，
 * 两者不能互相替代 —— sandbox 里始终没有 allow-same-origin。
 */
const HtmlViewer = forwardRef<NoteEditorHandle, HtmlViewerProps>(function HtmlViewer(
  { file, dirPath },
  ref
) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"preview" | "source">("preview");

  const relPath = file?.relPath ?? null;

  /**
   * 预览用的 iframe src
   *
   * 路径逐段编码：笔记名可能含空格 / 中文 / # 等字符，直接拼进 URL
   * 会被当成 fragment 或非法字符。encodeURIComponent 逐段处理，
   * 保留段间的 "/" 作为层级分隔。
   */
  const previewUrl = useMemo(() => {
    if (!relPath) return null;
    const encoded = relPath.split("/").map(encodeURIComponent).join("/");
    return `qnote-note://note/${encoded}`;
  }, [relPath]);

  useEffect(() => {
    setDirty(false);
    setMode("preview");
    if (!relPath || !dirPath) {
      setHtml("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const content = await window.electron.readHtmlNote(dirPath, relPath);
      if (cancelled) return;
      setHtml(content ?? "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [relPath, dirPath]);

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      currentRelPath: () => relPath,
      hasContent: () => html.trim().length > 0,
      save: async (targetRel?: string) => {
        const dest = targetRel ?? relPath;
        if (!dest || !dirPath) return false;
        const ok = await window.electron.writeHtmlNote(dirPath, dest, html);
        if (ok && !targetRel) setDirty(false);
        return ok;
      },
      isDirty: () => dirty,
      reload: async () => {
        if (!relPath || !dirPath) return;
        const content = await window.electron.readHtmlNote(dirPath, relPath);
        setHtml(content ?? "");
        setDirty(false);
      },
    }),
    [html, relPath, dirPath, dirty]
  );

  if (!relPath) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground/50">
        <Code2 className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">从左侧选择一个 HTML 文件</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div
        className="flex items-center gap-2 px-4 h-11 flex-shrink-0 border-b"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <Code2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <span className="text-sm text-muted-foreground truncate flex-1 min-w-0" title={relPath}>
          {file?.name}
        </span>
        {dirty && (
          <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">
            未保存
          </span>
        )}

        {/* 预览 / 源码切换：HTML 既是产物也是代码，两个视图都得能进 */}
        <div
          className="flex items-center gap-0.5 p-0.5 flex-shrink-0"
          style={{
            backgroundColor: "hsl(var(--muted) / 0.5)",
            borderRadius: "calc(var(--radius) * 0.8)",
          }}
        >
          {(
            [
              { key: "preview", label: "预览", Icon: Eye },
              { key: "source", label: "源码", Icon: Code2 },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={cn(
                "flex items-center gap-1 px-2 h-6 rounded text-xs transition-all duration-150",
                mode === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              style={mode === key ? { color: "hsl(var(--primary))" } : undefined}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 flex-shrink-0"
              aria-label="在浏览器中打开"
              onClick={() => {
                if (!dirPath || !relPath) return;
                // 沙箱内的 blob 窗口会被 CSP 拦掉，这里交给系统浏览器更稳
                void window.electron.revealInFolder(dirPath, relPath);
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">在文件管理器中定位</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 min-h-0 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
          </div>
        ) : mode === "preview" ? (
          <iframe
            key={relPath}
            title={file?.name ?? "HTML 笔记"}
            src={previewUrl ?? undefined}
            sandbox="allow-scripts allow-forms allow-popups"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <textarea
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            placeholder="<html>…</html>"
            className="h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-0"
          />
        )}
      </div>
    </div>
  );
});

export default HtmlViewer;