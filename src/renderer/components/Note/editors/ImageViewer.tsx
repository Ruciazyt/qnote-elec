import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ImageIcon, Minus, Plus, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoteFileEntry } from "../../../../shared/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";
import { cn } from "@/lib/utils";

interface ImageViewerProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
}

/**
 * 图片笔记查看器 —— 只读。
 *
 * 图片笔记的正文就是图片本身，没有可编辑的内容，
 * 所以这里的 save 永远返回 false：父组件据此禁用 Ctrl+S 之类的保存入口。
 */
const ImageViewer = forwardRef<NoteEditorHandle, ImageViewerProps>(function ImageViewer(
  { file, dirPath },
  ref
) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);

  const relPath = file?.relPath ?? null;

  useEffect(() => {
    setZoom(1);
    setFitMode(true);
    if (!relPath || !dirPath) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const content = await window.electron.readNote(dirPath, relPath);
      if (cancelled) return;
      setDataUrl(content && content.type === "image" ? content.dataUrl : null);
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
      // 只读，恒为 false
      isDirty: () => false,
    }),
    [relPath]
  );

  if (!relPath) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground/50">
        <ImageIcon className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">从左侧选择一张图片</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div
        className="flex items-center gap-2 px-4 h-11 flex-shrink-0 border-b"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <ImageIcon className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <span className="text-sm text-muted-foreground truncate flex-1 min-w-0" title={relPath}>
          {file?.name}
        </span>
        {file && (
          <span className="text-xs text-muted-foreground/50 tabular-nums flex-shrink-0">
            {(file.size / 1024).toFixed(0)} KB
          </span>
        )}

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="缩小"
            onClick={() => {
              setFitMode(false);
              setZoom((z) => Math.max(0.1, Number((z - 0.1).toFixed(2))));
            }}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <button
            type="button"
            onClick={() => {
              setFitMode((f) => !f);
              setZoom(1);
            }}
            className="text-xs tabular-nums w-12 text-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="切换适应窗口"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="放大"
            onClick={() => {
              setFitMode(false);
              setZoom((z) => Math.min(8, Number((z + 0.1).toFixed(2))));
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={cn("h-7 w-7", fitMode && "text-primary")}
            aria-label="适应窗口"
            onClick={() => {
              setFitMode((f) => !f);
              setZoom(1);
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6"
        style={{ backgroundColor: "hsl(var(--muted) / 0.25)" }}
      >
        {loading ? (
          <div className="w-6 h-6 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
        ) : dataUrl ? (
          <img
            src={dataUrl}
            alt={file?.name ?? ""}
            className={cn(
              "transition-all duration-150",
              fitMode ? "max-w-full max-h-full object-contain" : "max-w-none max-h-none"
            )}
            style={{ transform: fitMode ? undefined : `scale(${zoom})` }}
            draggable={false}
          />
        ) : (
          <p className="text-sm text-muted-foreground/60">图片加载失败</p>
        )}
      </div>
    </div>
  );
});

export default ImageViewer;
