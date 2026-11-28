import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Braces,
  Minus,
  Link2,
  Link2Off,
  Save,
  ImagePlus,
  Loader2,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  Table,
  Rows3,
  Columns3,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/ui/use-toast";
import "@/styles/note-editor.css";
import { NoteFileEntry } from "../../../../shared/notes/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";
import { findHeadingAnchor } from "./anchorLinks";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
  onSaved: (relPath: string) => void;
  onRequestSaveAs: () => void;
}

function ToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "h-7 w-7 rounded flex items-center justify-center transition-all duration-150",
            "disabled:opacity-35 disabled:cursor-not-allowed",
            active
              ? "bg-primary/15 text-primary-strong"
              : "text-muted-foreground hover:text-foreground hover:bg-accent active:scale-90"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

const ToolDivider = () => (
  <div className="hidden xl:block w-px h-4 bg-[hsl(var(--divider))] mx-0.5 flex-shrink-0" />
);

function TableGridPicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const MAX = 8;
  const [hover, setHover] = useState({ rows: 3, cols: 3 });

  return (
    <div
      className="grid grid-cols-8 gap-1 w-max"
      onMouseLeave={() => setHover({ rows: 3, cols: 3 })}
    >
      {Array.from({ length: MAX * MAX }).map((_, i) => {
        const r = Math.floor(i / MAX);
        const c = i % MAX;
        const active = r < hover.rows && c < hover.cols;
        return (
          <button
            key={i}
            type="button"
            aria-label={`${r + 1} 行 ${c + 1} 列`}
            className={cn(
              "h-5 w-5 rounded-sm border transition-colors",
              active
                ? "bg-primary border-primary"
                : "border-border hover:border-primary/60"
            )}
            onMouseEnter={() => setHover({ rows: r + 1, cols: c + 1 })}
            onClick={() => onPick(r + 1, c + 1)}
          />
        );
      })}
    </div>
  );
}

function TableOpButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 justify-start gap-1.5 px-2 text-xs"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const RichTextEditor = forwardRef<NoteEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { file, dirPath, onSaved, onRequestSaveAs },
  ref
) {
  const [dirty, setDirty] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [tableOpen, setTableOpen] = useState(false);
  const [insertingImage, setInsertingImage] = useState(false);
  const loadedRelRef = useRef<string | null>(null);
  const dirPathRef = useRef<string | null>(dirPath);
  dirPathRef.current = dirPath;

  const editorRef = useRef<Editor | null>(null);

  const jumpToAnchor = useCallback((href: string) => {
    const current = editorRef.current;
    if (!current) return;
    const anchor = findHeadingAnchor(current.state.doc, href);
    if (!anchor) {
      toast({
        title: "未找到跳转目标",
        description: "这篇笔记里没有对应的标题",
        variant: "destructive",
      });
      return;
    }
    current.commands.setTextSelection(anchor.pos + 1);
    window.setTimeout(() => {
      const dom = current.view.domAtPos(anchor.pos + 1).node;
      const element = dom instanceof HTMLElement ? dom : dom.parentElement;
      if (!element) return;
      element.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
    }, 0);
  }, []);

  const handleLinkClick = useCallback(
    (href: string) => {
      if (href.startsWith("#")) {
        jumpToAnchor(href);
        return;
      }
      void window.electron.openExternal(href).then((ok) => {
        if (ok) return;
        toast({
          title: "无法打开链接",
          description: "只支持 http、https 与 mailto 链接",
          variant: "destructive",
        });
      });
    },
    [jumpToAnchor]
  );

  const insertImage = useCallback((dataUrl: string) => {
    editorRef.current?.chain().focus().setImage({ src: dataUrl, alt: "" }).run();
  }, []);

  const handleImageFiles = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return false;

      setInsertingImage(true);
      void (async () => {
        for (const file of images) {
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(typeof reader.result === 'string' ? reader.result : '');
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });
            const root = dirPathRef.current;
            if (root) await window.electron.saveImageAsset(root, dataUrl);
            insertImage(dataUrl);
          } catch (err) {
            console.error("插入图片失败", err);
          }
        }
        setInsertingImage(false);
      })();
      return true;
    },
    [insertImage]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({
        allowBase64: false,
        inline: false,
        HTMLAttributes: { class: "rounded-md" },
      }),
      Placeholder.configure({ placeholder: "在这里开始写…" }),
      TableKit,
      Markdown,
    ],
    content: "",
    contentType: "markdown",
    onUpdate: () => setDirty(true),
    editorProps: {
      attributes: { spellcheck: "false" },
      handleClick: (_view, _pos, event) => {
        if (event.button !== 0) return false;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;
        const anchor = target.closest("a");
        if (!anchor) return false;
        const href = anchor.getAttribute("href");
        if (!href) return false;
        event.preventDefault();
        handleLinkClick(href);
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        return handleImageFiles(files);
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        return handleImageFiles(files);
      },
    },
  });

  editorRef.current = editor;
  const relPath = file?.relPath ?? null;

  const loadSeqRef = useRef(0);

  const loadIntoEditor = useCallback(
    async (target: string, force: boolean) => {
      if (!dirPath || !editor) return;
      const key = `${dirPath}\u0000${target}`;
      if (!force && loadedRelRef.current === key) return;
      const seq = ++loadSeqRef.current;
      const md = await window.electron.readMarkdownNote(dirPath, target);
      if (seq !== loadSeqRef.current) return;
      editor.commands.setContent(md, { contentType: "markdown", emitUpdate: false });
      loadedRelRef.current = key;
      setDirty(false);
    },
    [dirPath, editor]
  );

  useEffect(() => {
    if (!editor) return;
    if (!relPath || !dirPath) {
      loadSeqRef.current += 1;
      if (loadedRelRef.current !== null) {
        editor.commands.setContent("", { contentType: "markdown", emitUpdate: false });
        loadedRelRef.current = null;
      }
      setDirty(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadIntoEditor(relPath, false);
    })();
    return () => {
      cancelled = true;
    };
  }, [relPath, dirPath, editor, loadIntoEditor]);

  const save = useCallback(
    async (targetRelPath?: string): Promise<boolean> => {
      const target = targetRelPath ?? relPath;
      if (!dirPath || !target || !editor) return false;
      const ok = await window.electron.writeMarkdownNote(dirPath, target, editor.getMarkdown());
      if (ok) {
        loadedRelRef.current = `${dirPath}\u0000${target}`;
        setDirty(false);
        onSaved(target);
      }
      return ok;
    },
    [dirPath, relPath, editor, onSaved]
  );

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      currentRelPath: () => relPath,
      hasContent: () => relPath !== null || !(editor?.isEmpty ?? true),
      save,
      isDirty: () => dirty,
      reload: async () => {
        if (!relPath) return;
        await loadIntoEditor(relPath, true);
      },
    }),
    [relPath, editor, save, dirty, loadIntoEditor]
  );

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      strike: e?.isActive("strike") ?? false,
      code: e?.isActive("code") ?? false,
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      h3: e?.isActive("heading", { level: 3 }) ?? false,
      paragraph: e?.isActive("paragraph") ?? false,
      bulletList: e?.isActive("bulletList") ?? false,
      orderedList: e?.isActive("orderedList") ?? false,
      taskList: e?.isActive("taskList") ?? false,
      blockquote: e?.isActive("blockquote") ?? false,
      codeBlock: e?.isActive("codeBlock") ?? false,
      link: e?.isActive("link") ?? false,
      inTable: e?.isActive("table") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  const pickImage = useCallback(async () => {
    const root = dirPathRef.current;
    if (!root || insertingImage) return;
    setInsertingImage(true);
    try {
      const picked = await window.electron.pickAndSaveImage(root);
      if (picked) insertImage(picked.dataUrl);
    } finally {
      setInsertingImage(false);
    }
  }, [insertImage, insertingImage]);

  const chain = () => editor?.chain().focus();

  const applyLink = () => {
    if (!editor) return;
    if (linkOpen) {
      const url = linkValue.trim();
      if (!url) {
        chain()?.extendMarkRange("link").unsetLink().run();
      } else {
        const href = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) ? url : `https://${url}`;
        chain()?.extendMarkRange("link").setLink({ href }).run();
      }
    }
    setLinkOpen(false);
  };


  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full w-full flex flex-col min-h-0">
        {
}
        <div
          className="flex items-center gap-0.5 gap-y-1 px-3 min-h-11 py-1.5 flex-shrink-0 border-b flex-wrap"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <ToolButton label="撤销 (Ctrl+Z)" disabled={!toolbar.canUndo} onClick={() => chain()?.undo().run()}>
            <Undo2 className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="重做 (Ctrl+Shift+Z)" disabled={!toolbar.canRedo} onClick={() => chain()?.redo().run()}>
            <Redo2 className="h-3.5 w-3.5" />
          </ToolButton>

          <ToolDivider />

          <ToolButton label="正文" active={toolbar.paragraph} onClick={() => chain()?.setParagraph().run()}>
            <Pilcrow className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="一级标题" active={toolbar.h1} onClick={() => chain()?.toggleHeading({ level: 1 }).run()}>
            <Heading1 className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="二级标题" active={toolbar.h2} onClick={() => chain()?.toggleHeading({ level: 2 }).run()}>
            <Heading2 className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="三级标题" active={toolbar.h3} onClick={() => chain()?.toggleHeading({ level: 3 }).run()}>
            <Heading3 className="h-3.5 w-3.5" />
          </ToolButton>

          <ToolDivider />

          <ToolButton label="加粗 (Ctrl+B)" active={toolbar.bold} onClick={() => chain()?.toggleBold().run()}>
            <Bold className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="斜体 (Ctrl+I)" active={toolbar.italic} onClick={() => chain()?.toggleItalic().run()}>
            <Italic className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="下划线 (Ctrl+U)" active={toolbar.underline} onClick={() => chain()?.toggleUnderline().run()}>
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="删除线" active={toolbar.strike} onClick={() => chain()?.toggleStrike().run()}>
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="行内代码" active={toolbar.code} onClick={() => chain()?.toggleCode().run()}>
            <Code className="h-3.5 w-3.5" />
          </ToolButton>

          <ToolDivider />

          <ToolButton label="无序列表" active={toolbar.bulletList} onClick={() => chain()?.toggleBulletList().run()}>
            <List className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="有序列表" active={toolbar.orderedList} onClick={() => chain()?.toggleOrderedList().run()}>
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="任务列表" active={toolbar.taskList} onClick={() => chain()?.toggleTaskList().run()}>
            <ListChecks className="h-3.5 w-3.5" />
          </ToolButton>

          <ToolDivider />

          <ToolButton label="引用" active={toolbar.blockquote} onClick={() => chain()?.toggleBlockquote().run()}>
            <Quote className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="代码块" active={toolbar.codeBlock} onClick={() => chain()?.toggleCodeBlock().run()}>
            <Braces className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton label="分割线" onClick={() => chain()?.setHorizontalRule().run()}>
            <Minus className="h-3.5 w-3.5" />
          </ToolButton>

          <ToolDivider />

          {}
          <Popover open={tableOpen} onOpenChange={setTableOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="表格"
                aria-pressed={toolbar.inTable}
                className={cn(
                  "h-7 w-7 rounded flex items-center justify-center transition-all duration-150",
                  toolbar.inTable
                    ? "bg-primary/15 text-primary-strong"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent active:scale-90"
                )}
              >
                <Table className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-64 p-3">
              <p className="text-xs text-muted-foreground mb-2">插入表格</p>
              <TableGridPicker
                onPick={(rows, cols) => {
                  chain()?.insertTable({ rows, cols, withHeaderRow: true }).run();
                  setTableOpen(false);
                }}
              />
              {toolbar.inTable && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs text-muted-foreground mb-1.5">当前表格</p>
                  <div className="grid grid-cols-2 gap-0.5">
                    <TableOpButton
                      icon={Rows3}
                      label="上方插入行"
                      onClick={() => chain()?.addRowBefore().run()}
                    />
                    <TableOpButton
                      icon={Rows3}
                      label="下方插入行"
                      onClick={() => chain()?.addRowAfter().run()}
                    />
                    <TableOpButton
                      icon={Columns3}
                      label="左侧插入列"
                      onClick={() => chain()?.addColumnBefore().run()}
                    />
                    <TableOpButton
                      icon={Columns3}
                      label="右侧插入列"
                      onClick={() => chain()?.addColumnAfter().run()}
                    />
                    <TableOpButton
                      icon={Minus}
                      label="删除当前行"
                      onClick={() => chain()?.deleteRow().run()}
                    />
                    <TableOpButton
                      icon={Minus}
                      label="删除当前列"
                      onClick={() => chain()?.deleteColumn().run()}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-full mt-1 justify-start gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      chain()?.deleteTable().run();
                      setTableOpen(false);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除表格
                  </Button>
                </>
              )}
            </PopoverContent>
          </Popover>

          <ToolDivider />

          <ToolButton
            label="插入图片"
            disabled={insertingImage}
            onClick={() => void pickImage()}
          >
            {insertingImage ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
          </ToolButton>

          <Popover open={linkOpen} onOpenChange={setLinkOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="链接"
                aria-pressed={toolbar.link}
                className={cn(
                  "h-7 w-7 rounded flex items-center justify-center transition-all duration-150",
                  toolbar.link || linkOpen
                    ? "bg-primary/15 text-primary-strong"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent active:scale-90"
                )}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-80 p-3">
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={linkValue}
                  placeholder="https://example.com"
                  className="h-8 text-sm"
                  onChange={(e) => setLinkValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyLink();
                    }
                    if (e.key === "Escape") setLinkOpen(false);
                  }}
                />
                <Button size="sm" className="h-8 px-2.5 text-xs" onClick={applyLink}>
                  确定
                </Button>
                {toolbar.link && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 flex-shrink-0"
                    aria-label="移除链接"
                    onClick={() => {
                      chain()?.extendMarkRange("link").unsetLink().run();
                      setLinkOpen(false);
                    }}
                  >
                    <Link2Off className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {}
        <div
          className="flex items-center gap-2 px-4 h-9 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <span className="text-sm text-muted-foreground truncate flex-1 min-w-0" title={relPath ?? undefined}>
            {file?.name ?? "未保存的文本文档"}
            {dirty && <span className="ml-1.5 text-primary">•</span>}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => (relPath ? void save() : onRequestSaveAs())}
          >
            <Save className="h-3 w-3" />
            {relPath ? "保存" : "另存为"}
          </Button>
        </div>

        {
}
        <div className="flex-1 min-h-0 overflow-y-auto note-editor-scroll">
          <EditorContent editor={editor} />
        </div>
      </div>
    </TooltipProvider>
  );
});

export default React.memo(RichTextEditor);
