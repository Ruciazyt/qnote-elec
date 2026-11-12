import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NoteFileEntry } from "../../../../shared/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";

interface PdfViewerProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
  /**
   * 文件所属的外部文件夹 id；null / undefined = 在笔记根目录里
   *
   * 预览走 qnote-note:// 协议，主进程按这个 id 查回真实目录 ——
   * 外部文件夹里的文件不在笔记根目录下，不带 id 会去根目录找同名的文件。
   */
  externalId?: string | null;
}

/**
 * PDF 笔记查看器 —— 只读。
 *
 * 正文是 PDF 本身，没有可编辑的内容，save 永远返回 false，
 * 父组件据此禁用 Ctrl+S / 另存为。用户在应用里能做的只有两件事：
 * 内置阅读器翻页，或丢给系统默认程序打开（后者排版还原度更好）。
 *
 * ## 预览地址为什么走 qnote-note:// 协议
 *
 * 早先是把 PDF 读成 base64 的 data: URL 交给 Chromium 内置阅读器的。
 * data: URL 有硬上限：Chromium 的 URL 长度上限是 2MB，base64 还要把体积膨胀约 1/3，
 * 于是超过约 1.5MB 的 PDF 一律加载失败 —— 表现是一个空白灰框，
 * 控制台不报错、也没有 error 事件，看起来像"预览不出来"。
 *
 * 协议没有这个限制：文件按流送出，几十 MB 的 PDF 照样能开。
 * 主进程侧的协议实现见 src/main/handlers/notesProtocol.ts。
 *
 * 依赖主窗口开着 plugins:true，否则 Chromium 不会接管 <object type="application/pdf">，
 * 表现是空白框且控制台无报错。
 */
const PdfViewer = forwardRef<NoteEditorHandle, PdfViewerProps>(function PdfViewer(
  { file, dirPath, externalId },
  ref
) {
  const [failed, setFailed] = useState(false);
  const objectRef = useRef<HTMLObjectElement | null>(null);

  const relPath = file?.relPath ?? null;

  /**
   * 预览地址
   *
   * 路径逐段编码：笔记名可能含空格 / 中文 / # 等字符，直接拼进 URL
   * 会被当成 fragment 或非法字符。规则与 HTML 笔记预览保持一致。
   *
   * 末尾带 mtime 是为了绕开缓存 —— 文件在外部被替换后重新打开，能看到新版本。
   * 协议只读 pathname，查询参数不影响它解析出相对路径。
   *
   * 外部文件夹里的文件走 ext/<id>/ 形式 —— 主进程按 id 查回那个文件夹，
   * 渲染层不能自己指定目录（见 notesProtocol.ts）。
   */
  const previewUrl = useMemo(() => {
    if (!relPath) return null;
    const encoded = relPath.split("/").map(encodeURIComponent).join("/");
    const base = externalId
      ? `qnote-note://ext/${encodeURIComponent(externalId)}/${encoded}`
      : `qnote-note://note/${encoded}`;
    return `${base}?v=${file?.mtime ?? 0}`;
  }, [relPath, file?.mtime, externalId]);

  /** 换文件时清掉上一次的失败态 */
  useEffect(() => {
    setFailed(false);
  }, [previewUrl]);

  /**
   * 加载失败感知
   *
   * 资源取不到时 <object> 会派发 error 事件，但这个事件不冒泡，
   * React 的 onError 挂在根节点上收不到，所以自己用原生监听器。
   */
  useEffect(() => {
    const el = objectRef.current;
    if (!el) return;
    const onError = () => setFailed(true);
    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, [previewUrl]);

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
    // openInExplorer 走的是 shell.openPath：传文件路径就是「用默认程序打开这个文件」
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
          /* 用 object 而不是 embed：object 失败时会派发 error 事件，
             embed 失败则是纯空白，连"加载失败"都感知不到 */
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
