import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "@/styles/note-editor.css";
import { NoteFileEntry } from "../../../../shared/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
  /** 保存成功后回调，参数是落盘的 relPath */
  onSaved: (relPath: string) => void;
  onRequestSaveAs: () => void;
}

/** 工具栏按钮 */
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
              ? "bg-primary/15 text-primary"
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

/**
 * 工具栏分组线。用 --divider 而非 --border：后者（91% 亮度）落在白底上几乎看不见。
 *
 * xl 以下整条隐藏
 * 窄屏下工具栏会折行，而 flex 无法感知「某个分隔线是不是这一行的第一个」——
 * 一旦折行，行首就会孤零零立着一小段竖线（正是用户截图里那个）。
 * 与其等它出现再去救，不如窄屏直接不画分隔线：一行放得下时（≥1280px）才启用。
 */
const ToolDivider = () => (
  <div className="hidden xl:block w-px h-4 bg-[hsl(var(--divider))] mx-0.5 flex-shrink-0" />
);

const RichTextEditor = forwardRef<NoteEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { file, dirPath, onSaved, onRequestSaveAs },
  ref
) {
  const [dirty, setDirty] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [insertingImage, setInsertingImage] = useState(false);
  /** 已经灌进编辑器的条目路径。
   *  另存为后父组件会把 file 换成新条目，这里记下来就能跳过重新加载 ——
   *  否则会重置光标位置和撤销历史，用户刚写的东西体验上像是"被弹了一下"。 */
  const loadedRelRef = useRef<string | null>(null);
  /** 插入图片时要落盘的目录，随当前笔记走 */
  const dirPathRef = useRef<string | null>(dirPath);
  dirPathRef.current = dirPath;

  // insertImage / pickImage 通过 ref 读 editor：useEditor 首次渲染返回 null，
  // 直接闭包捕获会永远拿到 null
  const editorRef = useRef<Editor | null>(null);

  /** 把 dataUrl 插入光标处。图片内容先落盘到 assets/，正文里最终只留相对路径。 */
  const insertImage = useCallback((dataUrl: string) => {
    // 插入时用 dataUrl —— 相对路径在编辑器里显示不出来
    editorRef.current?.chain().focus().setImage({ src: dataUrl, alt: "" }).run();
  }, []);

  /** 粘贴 / 拖入的图片统一走这里 */
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
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });
            // 先落盘再插入：即使用户不保存正文，资源也不会丢在临时目录
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
        // 禁止内联 base64 落进文档：图片一律先存成资源文件
        allowBase64: false,
        inline: false,
        HTMLAttributes: { class: "rounded-md" },
      }),
      Placeholder.configure({ placeholder: "在这里开始写…" }),
      Markdown,
    ],
    // 空文档起步，实际内容由下面的 effect 按文件加载
    content: "",
    contentType: "markdown",
    onUpdate: () => setDirty(true),
    editorProps: {
      attributes: { spellcheck: "false" },
      /** 粘贴图片：接管 TipTap 默认的内联 base64 行为 */
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        return handleImageFiles(files);
      },
      /** 拖入图片 */
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        return handleImageFiles(files);
      },
    },
  });

  editorRef.current = editor;
  const relPath = file?.relPath ?? null;

  /**
   * 把磁盘上的正文灌进编辑器。
   * force=true 时无视 loadedRelRef 短路 —— 外部改动检测依赖这个入口，
   * 同一个 relPath 的内容变了也得重新灌。
   */
  const loadIntoEditor = useCallback(
    async (target: string, force: boolean) => {
      if (!dirPath || !editor) return;
      if (!force && loadedRelRef.current === target) return;
      // 走 markdown 专用通道：主进程会把本地图片的相对路径换成 dataUrl
      const md = await window.electron.readMarkdownNote(dirPath, target);
      // emitUpdate:false —— 加载不是用户输入，别把它算成一次编辑
      editor.commands.setContent(md, { contentType: "markdown", emitUpdate: false });
      loadedRelRef.current = target;
      setDirty(false);
    },
    [dirPath, editor]
  );

  // 切换条目时重新载入。依赖 relPath 而非 file 对象：
  // tree() 每次刷新都返回新对象，用对象做依赖会把用户正在编辑的内容冲掉。
  useEffect(() => {
    if (!editor) return;
    if (!relPath || !dirPath) {
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
      // 主进程会把内嵌的 dataUrl 抽出来存进 assets/，正文里只留相对路径
      const ok = await window.electron.writeMarkdownNote(dirPath, target, editor.getMarkdown());
      if (ok) {
        // 另存为后父组件会改 file，这里先记下，避免重新灌内容导致光标和撤销历史被清空
        loadedRelRef.current = target;
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
      // 空白状态下写了字也算有内容，可以直接另存为
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

  /**
   * 工具栏的激活态单独订阅，避免每次按键都重渲染整棵组件树。
   * useEditorState 只在 selector 返回值真正变化时才触发 re-render。
   */
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
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  /** 工具栏选图：走系统文件选择框 */
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
        // 用户常直接粘 "example.com"，没有协议头，浏览器会当相对路径处理
        const href = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url) ? url : `https://${url}`;
        chain()?.extendMarkRange("link").setLink({ href }).run();
      }
    }
    setLinkOpen(false);
  };

  const openLinkEditor = () => {
    if (!editor) return;
    setLinkValue((editor.getAttributes("link").href as string) ?? "");
    setLinkOpen((v) => !v);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full w-full flex flex-col min-h-0">
        {/* 工具栏
            min-h-11 而非 h-11：配合 flex-wrap，
            固定高度会让折行后的第二行溢出 44px 的框、压到下面的标题栏上。
            gap-y-1 给折行后的行距留白。 */}
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
                    ? "bg-primary/15 text-primary"
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

        {/* 标题栏 */}
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

        {/* 编辑区 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    </TooltipProvider>
  );
});

export default RichTextEditor;
