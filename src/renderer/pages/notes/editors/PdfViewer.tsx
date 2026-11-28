import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NoteFileEntry } from "../../../../shared/notes/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";

interface PdfViewerProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
  externalId?: string | null;
}

const PdfViewer = forwardRef<NoteEditorHandle, PdfViewerProps>(function PdfViewer(
  { file, dirPath, externalId },
  ref
) {
  const [failed, setFailed] = useState(false);
  const objectRef = useRef<HTMLObjectElement | null>(null);

  const relPath = file?.relPath ?? null;

  const previewUrl = useMemo(() => {
    if (!relPath) return null;
    const encoded = relPath.split("/").map(encodeURIComponent).join("/");
    const base = externalId
      ? `qnote-note://ext/${encodeURIComponent(externalId)}/${encoded}`
      : `qnote-note://note/${encoded}`;
    return `${base}?v=${file?.mtime ?? 0}`;
  }, [relPath, file?.mtime, externalId]);

  useEffect(() => {
    setFailed(false);
  }, [previewUrl]);

  useEffect(() => {
    const el = objectRef.current;
    if (!el) return;
    const onError = () => setFailed(true);
    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, [previewUrl, failed]);

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      currentRelPath: () => relPath,
      hasContent: () => false,
      save: async () => false,
      isDirty: () => false,
    }),
    [relPath]
  );

  const openExternally = async () => {
    if (!dirPath || !relPath) return;
    await window.electron.openInExplorer(dirPath, relPath);
  };

  if (!relPath) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground/50">
        <FileText className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">从左侧选择一个 PDF 文件</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div
        className="flex items-center gap-2 px-4 h-11 flex-shrink-0 border-b"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <FileText className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <span className="text-sm text-muted-foreground truncate flex-1 min-w-0" title={relPath}>
          {file?.name}
        </span>
        {file && (
          <span className="text-xs text-muted-foreground/50 tabular-nums flex-shrink-0">
            {(file.size / 1024 / 1024).toFixed(1)} MB
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 flex-shrink-0"
              aria-label="用系统默认程序打开"
              onClick={() => void openExternally()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <p className="text-xs">用系统默认程序打开</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{ backgroundColor: "hsl(var(--muted) / 0.25)" }}
      >
        {failed ? (
          <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground">
            <FileText className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">PDF 加载失败，文件可能已被移动或删除</p>
          </div>
        ) : (
          <object
            key={previewUrl}
            ref={objectRef}
            data={previewUrl ?? ""}
            type="application/pdf"
            className="h-full w-full"
          >
            <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground p-6">
              <FileText className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm mb-1">当前环境无法内嵌显示 PDF</p>
              <p className="text-xs text-muted-foreground/50">
                可点右上角按钮用系统默认程序打开
              </p>
            </div>
          </object>
        )}
      </div>
    </div>
  );
});

export default React.memo(PdfViewer);
