import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NoteFileEntry } from "../../../../shared/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";

interface PdfViewerProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
}

/**
 * PDF 笔记查看器 —— 只读。
 *
 * 正文是 PDF 本身，没有可编辑的内容，save 永远返回 false，
 * 父组件据此禁用 Ctrl+S / 另存为。用户在应用里能做的只有两件事：
 * 内置阅读器翻页，或丢给系统默认程序打开（后者排版还原度更好）。
 *
 * 依赖主窗口开着 plugins:true，否则 Chromium 不会接管 <embed>，
 * 表现是空白框且控制台无报错。
 */
const PdfViewer = forwardRef<NoteEditorHandle, PdfViewerProps>(function PdfViewer(
  { file, dirPath },
  ref
) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const relPath = file?.relPath ?? null;

  useEffect(() => {
    setFailed(false);
    if (!relPath || !dirPath) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const content = await window.electron.readNote(dirPath, relPath);
      if (cancelled) return;
      setDataUrl(content && content.type === "pdf" ? content.dataUrl : null);
      setFailed(!content || content.type !== "pdf");
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
      hasContent: () => false,
      save: async () => false,
      // 只读，没有「未保存改动」可言；显式返回 false，
      // 父组件就不用对不同类型分别判空
      isDirty: () => false,
    }),
    [relPath]
  );

  /** 交给系统默认程序打开 —— 内置阅读器在复杂排版上不如专业阅读器 */
  const openExternally = async () => {
    if (!dirPath || !relPath) return;
    await window.electron.revealInFolder(dirPath, relPath);
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
        {loading ? (
          <div className="h-full w-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
          </div>
        ) : failed ? (
          <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground/60">
            <FileText className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">PDF 加载失败，文件可能已被移动或删除</p>
          </div>
        ) : (
          /* 用 object 而不是 embed：object 失败时会渲染出内部内容（通常带下载提示），
             embed 失败则是纯空白，空白无法和「加载中」区分开 */
          <object
            key={relPath}
            data={dataUrl ?? ""}
            type="application/pdf"
            className="h-full w-full"
          >
            <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground/60 p-6">
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

export default PdfViewer;