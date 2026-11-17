import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Code2, ExternalLink, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NoteFileEntry } from "../../../../shared/notes/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";
import { cn } from "@/lib/utils";

interface HtmlViewerProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
  externalId?: string | null;
}

const HtmlViewer = forwardRef<NoteEditorHandle, HtmlViewerProps>(function HtmlViewer(
  { file, dirPath, externalId },
  ref
) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"preview" | "source">("preview");

  const relPath = file?.relPath ?? null;

  const previewUrl = useMemo(() => {
    if (!relPath) return null;
    const encoded = relPath.split("/").map(encodeURIComponent).join("/");
    if (externalId) {
      return `qnote-note://ext/${encodeURIComponent(externalId)}/${encoded}`;
    }
    return `qnote-note://note/${encoded}`;
  }, [relPath, externalId]);

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

        {}
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

export default React.memo(HtmlViewer);