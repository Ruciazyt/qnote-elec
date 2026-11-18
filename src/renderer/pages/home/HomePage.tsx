import { useState, useEffect, useRef } from "react";
import "@/styles/prism-clipboard.css";
import { useToast } from "@/hooks/ui/use-toast";
import { formatCode, type SupportedLanguage } from "@/utils/ai/codeFormatter";
import { highlightClipboardCodes } from "@/utils/clipboard/prismHighlight";
import { randomHex } from "@/utils/system/randomId";
import { ClipboardToolbar } from "@/pages/home/clipboard/ClipboardToolbar";
import { ClipboardList } from "@/pages/home/clipboard/ClipboardList";
import { ImageOcrDialog } from "@/pages/home/clipboard/ImageOcrDialog";
import { DeleteAllConfirmDialog } from "@/pages/home/clipboard/DeleteAllConfirmDialog";
import { ClipboardRecord, sortPinned } from "@/pages/home/clipboard/types";
import { ClipboardList as ClipboardListIcon, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShortcutPanel } from "@/pages/home/shortcut/ShortcutPanel";
import { TodoEditDialog } from "@/pages/todo/TodoEditDialog";
import type { TodoPriority } from "@/pages/todo/types";

export default function HomePage() {
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardRecord[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const { toast } = useToast();
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [dialogImage, setDialogImage] = useState<string | null>(null);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [addTodoDialogOpen, setAddTodoDialogOpen] = useState(false);
  const [savingNoteId, setSavingNoteId] = useState<number | null>(null);
  const [addTodoTitle, setAddTodoTitle] = useState("");
  const [addTodoAttachments, setAddTodoAttachments] = useState<
    import("@/pages/todo/types").TodoAttachment[]
  >([]);
  const [ocrResult, setOcrResult] = useState<string>("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrType, setOcrType] = useState<"standard" | "accurate" | "webimage">("standard");

  const codeContainerRef = useRef<HTMLDivElement>(null);
  const codeVisibleRef = useRef(false);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

  const [formattingRecordId, setFormattingRecordId] = useState<number | undefined>(undefined);
  const formattedLanguagesState = useState<{ [key: number]: SupportedLanguage }>({});
  const formattedLanguages = formattedLanguagesState[0];
  const setFormattedLanguages = formattedLanguagesState[1];

  async function copyToClipboard(content: string, type: "text" | "image" = "text") {
    if (type === "image") {
      try {
        await window.electron.copyImageToClipboard(content);
        toast({ title: "已复制图片到剪贴板" });
      } catch (err) {
        console.error("Failed to copy image: ", err);
        toast({ title: "复制图片失败", variant: "destructive" });
      }
      return;
    }

    try {
      await window.electron.markClipboardCopied(content);
    } catch (err) {
      console.error("标记剪贴板自写失败:", err);
    }

    navigator.clipboard
      .writeText(content)
      .then(() => {
        toast({ title: "已复制到剪贴板" });
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err);
        toast({ title: "复制失败", variant: "destructive" });
      });
  }

  async function deleteRecord(id: number) {
    if (!id) {
      toast({ title: "删除失败", description: "记录ID不存在", variant: "destructive" });
      return;
    }
    try {
      const success = await window.electron.deleteNoteById(id);
      if (success) {
        setClipboardHistory((prev) => prev.filter((r) => r.id !== id));
        toast({ title: "已删除记录" });
      } else {
        toast({ title: "删除失败", variant: "destructive" });
      }
    } catch (err) {
      console.error("Error deleting record:", err);
      toast({ title: "删除失败", variant: "destructive" });
    }
  }

  const [clearStats, setClearStats] = useState<{ kept: number; total: number; removable: number } | null>(null);

  async function deleteAllRecords() {
    try {
      setClearStats(await window.electron.countProtectedNotes());
    } catch (err) {
      console.error("统计受保护记录失败:", err);
      setClearStats(null);
    }
    setDeleteAllDialogOpen(true);
  }

  const handleDeleteAllConfirm = async () => {
    setDeleteAllDialogOpen(false);
    try {
      const result = await window.electron.deleteAllNotes();
      if (result.success) {
        await loadHistory();
        const kept = clearStats?.kept ?? 0;
        toast({
          title: kept > 0 ? `已删除 ${result.deleted ?? 0} 条` : "已清空所有记录",
          description: kept > 0 ? `保留了 ${kept} 条置顶或重要的记录` : undefined,
        });
        setClearStats(null);
      } else {
        toast({
          title: "清空失败",
          description: result.error ?? "请稍后重试",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Error deleting all records:", err);
      toast({
        title: "清空失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  };

  async function handleTogglePin(record: ClipboardRecord) {
    if (record.id === undefined) return;
    const nextPinned = !record.pinned_at;
    const applyPinnedAt = (pinnedAt: number | null) =>
      setClipboardHistory((prev) =>
        sortPinned(prev.map((r) => (r.id === record.id ? { ...r, pinned_at: pinnedAt } : r)))
      );

    applyPinnedAt(nextPinned ? Date.now() : null);
    try {
      const result = await window.electron.toggleNotePin(record.id, nextPinned);
      if (!result.success) throw new Error(result.error);
      applyPinnedAt(result.pinned_at ?? null);
    } catch (err) {
      console.error("更新置顶状态失败:", err);
      applyPinnedAt(record.pinned_at ?? null);
      toast({ title: nextPinned ? "置顶失败" : "取消置顶失败", variant: "destructive" });
    }
  }

  const handleToggleImportant = async (record: ClipboardRecord) => {
    if (record.id === undefined) return;
    const next = record.is_important ? 0 : 1;
    setClipboardHistory((prev) =>
      prev.map((r) => (r.id === record.id ? { ...r, is_important: next } : r))
    );
    try {
      const result = await window.electron.toggleNoteImportant(record.id, next === 1);
      if (!result.success) throw new Error(result.error);
    } catch (err) {
      console.error("更新重要标记失败:", err);
      setClipboardHistory((prev) =>
        prev.map((r) => (r.id === record.id ? { ...r, is_important: record.is_important ?? 0 } : r))
      );
      toast({ title: "标记失败", variant: "destructive" });
    }
  };

  async function handleSearch(keyword: string) {
    setSearchKeyword(keyword);
    if (!keyword.trim()) {
      void loadHistory();
      return;
    }
    try {
      const results = await window.electron.searchNotes(keyword);
      setClipboardHistory(results);
    } catch (err) {
      console.error("Error searching records:", err);
      toast({ title: "搜索失败", variant: "destructive" });
    }
  }

  const loadHistory = async () => {
    try {
      const history = await window.electron.getClipboardHistory();
      setClipboardHistory(history);
    } catch (err) {
      console.error("Error loading clipboard history:", err);
    }
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem("formattedLanguages");
      if (stored) {
        const parsed = JSON.parse(stored) as Record<number, SupportedLanguage>;
        setFormattedLanguages(parsed);
      }
    } catch (error) {
      console.error("加载格式化语言缓存失败:", error);
    }
  }, [setFormattedLanguages]);

  useEffect(() => {
    void loadHistory();

    const handleClipboardChange = (_: unknown, data: ClipboardRecord) => {
      setClipboardHistory((prev) => {
        const isDuplicate = prev.some(
          (record) => record.content === data.content && record.type === data.type
        );
        if (isDuplicate) return prev;
        const newRecord = { ...data };
        return sortPinned([newRecord, ...prev]);
      });
    };

    window.electron.onClipboardChanged(handleClipboardChange);

    return () => {
      window.electron.removeClipboardChanged(handleClipboardChange);
    };
  }, []);

  useEffect(() => {
    const container = codeContainerRef.current;
    if (!container) return;

    if (typeof IntersectionObserver === "undefined") {
      highlightClipboardCodes(container);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      codeVisibleRef.current = entries.some((entry) => entry.isIntersecting);
      if (codeVisibleRef.current) highlightClipboardCodes(container);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!codeVisibleRef.current) return;
    highlightClipboardCodes(codeContainerRef.current);
  }, [clipboardHistory, formattedLanguages]);

  const handleImageClick = (img: string) => {
    setDialogImage(img);
    const record = clipboardHistory.find((r) => r.content === img);
    if (record?.ocr_result) {
      setOcrResult(record.ocr_result);
    } else {
      setOcrResult("");
    }
    setImageDialogOpen(true);
  };

  const handleOcrExtract = async () => {
    if (!dialogImage) return;
    setOcrLoading(true);
    setOcrResult("");
    let base64 = dialogImage;
    if (base64.startsWith("data:image")) {
      base64 = base64.split(",")[1];
    }
    try {
      let result = "";
      if (ocrType === "standard") {
        result = await window.electron.baiduOcr(base64);
      } else if (ocrType === "accurate") {
        result = await window.electron.baiduOcrAccurate(base64);
      } else if (ocrType === "webimage") {
        result = await window.electron.baiduOcrWebImage(dialogImage);
      }
      setOcrResult(result);
      if (result) {
        const currentRecord = clipboardHistory.find((r) => r.content === dialogImage);
        if (currentRecord?.id) {
          try {
            await window.electron.saveOcrResult(currentRecord.id, result);
            setClipboardHistory((prev) =>
              prev.map((r) => (r.id === currentRecord.id ? { ...r, ocr_result: result } : r))
            );
          } catch (err) {
            console.error("保存OCR结果失败:", err);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("OCR 识别失败:", err);
      toast({
        title: "OCR 识别失败",
        description: message,
        variant: "destructive",
      });
      setOcrResult("");
    } finally {
      setOcrLoading(false);
    }
  };


  const handleAddToMemory = async (record: ClipboardRecord) => {
    if (!record.id) {
      toast({ title: "索引失败", description: "记录ID不存在", variant: "destructive" });
      return;
    }
    if (record.vector_indexed) {
      try {
        const result = await window.electron.removeFromMemory(record.id);
        if (result.success) {
          setClipboardHistory((prev) =>
            prev.map((r) => (r.id === record.id ? { ...r, vector_indexed: 0, vector_id: "" } : r))
          );
          toast({ title: "已从记忆索引移除" });
        } else {
          toast({ title: "移除失败", description: result.error, variant: "destructive" });
        }
      } catch (err) {
        console.error("从记忆索引移除失败:", err);
        toast({ title: "操作失败", variant: "destructive" });
      }
    } else {
      try {
        toast({ title: "正在索引...", description: "正在写入本地记忆索引" });
        const result = await window.electron.addToMemory(record.id);
        if (result.success) {
          await loadHistory();
          toast({ title: "索引成功", description: "已添加到本地记忆索引" });
        } else {
          toast({ title: "索引失败", description: result.error, variant: "destructive" });
        }
      } catch (err) {
        console.error("添加到记忆索引失败:", err);
        toast({ title: "操作失败", variant: "destructive" });
      }
    }
  };

  const updateFormattedLanguageCache = (recordId: number, language: SupportedLanguage) => {
    setFormattedLanguages((prev) => {
      const next = { ...prev, [recordId]: language };
      try {
        localStorage.setItem("formattedLanguages", JSON.stringify(next));
      } catch (error) {
        console.error("保存格式化语言缓存失败:", error);
      }
      return next;
    });
  };

  const handleFormatCode = async (record: ClipboardRecord, language: SupportedLanguage) => {
    if (!record.id || record.type !== "text") {
      toast({ title: "格式化失败", description: "只能格式化文本内容", variant: "destructive" });
      return;
    }
    setFormattingRecordId(record.id);
    try {
      const formattedContent = await formatCode(record.content, language);
      const result = await window.electron.updateNoteContent(record.id, formattedContent);
      if (result.success) {
        setClipboardHistory((prev) =>
          prev.map((r) => (r.id === record.id ? { ...r, content: formattedContent } : r))
        );
        if (record.id) updateFormattedLanguageCache(record.id, language);
        toast({ title: "格式化成功", description: `代码已使用 ${language} 格式化` });
      } else {
        throw new Error(result.error || "更新数据库失败");
      }
    } catch (error) {
      console.error("格式化代码失败:", error);
      toast({ title: "格式化失败", description: error instanceof Error ? error.message : "未知错误", variant: "destructive" });
    } finally {
      setFormattingRecordId(undefined);
    }
  };

  const handleUpdateContent = async (record: ClipboardRecord, content: string) => {
    if (record.id === undefined) {
      toast({ title: "保存失败", description: "记录不存在", variant: "destructive" });
      throw new Error("记录不存在");
    }
    try {
      const result = await window.electron.updateNoteContent(record.id, content);
      if (!result.success) {
        throw new Error(result.error || "更新数据库失败");
      }
      setClipboardHistory((prev) =>
        prev.map((r) => (r.id === record.id ? { ...r, content } : r))
      );
      if (searchKeyword.trim()) {
        await handleSearch(searchKeyword);
      }
      toast({ title: "已保存" });
    } catch (error) {
      console.error("保存剪贴板内容失败:", error);
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleSaveAsNote = async (record: ClipboardRecord) => {
    if (record.id === undefined) return;
    if (savingNoteId !== null) return;
    setSavingNoteId(record.id);
    try {
      const dirPath = await window.electron.getFilePath();
      if (!dirPath) {
        toast({ title: "存为笔记失败", description: "请先在笔记页设置保存路径", variant: "destructive" });
        return;
      }
      const entry = await window.electron.saveClipboardRecordAsNote(
        dirPath,
        record.type,
        record.content
      );
      if (!entry) {
        toast({ title: "存为笔记失败", description: "内容为空或格式无法识别", variant: "destructive" });
        return;
      }
      toast({
        title: record.type === "image" ? "已存为图片笔记" : "已存为文本笔记",
        description: entry.name,
      });
    } catch (error) {
      console.error("存为笔记失败:", error);
      toast({
        title: "存为笔记失败",
        description: error instanceof Error ? error.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setSavingNoteId(null);
    }
  };

  const handleAddToTodo = (record: ClipboardRecord) => {
    if (record.type === "image") {
      const dataUrl = (record.content || "").trim();
      if (!dataUrl || !dataUrl.startsWith("data:image/")) {
        toast({ title: "无法添加", description: "图片数据无效", variant: "destructive" });
        return;
      }
      const ocr = (record as any).ocr_result as string | undefined;
      const titleFromOcr = ocr ? ocr.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      setAddTodoTitle(titleFromOcr || "图片待办");
      setAddTodoAttachments([
        {
          id: `att_${Date.now()}_${randomHex(6)}`,
          type: "image",
          dataUrl,
          name: `clipboard-${record.id ?? Date.now()}.png`,
        },
      ]);
      setAddTodoDialogOpen(true);
      return;
    }

    const content = (record.content || "").trim();
    if (!content) {
      toast({ title: "无法添加", description: "剪贴板内容为空", variant: "destructive" });
      return;
    }
    const truncated = content.length > 80 ? content.slice(0, 80) + "…" : content;
    setAddTodoTitle(truncated);
    setAddTodoAttachments([]);
    setAddTodoDialogOpen(true);
  };

  const handleOpenUrl = async (record: ClipboardRecord, url: string) => {
    try {
      const ok = await window.electron.openExternal(url);
      if (!ok) {
        toast({ title: "打不开链接", description: url, variant: "destructive" });
      }
    } catch (err) {
      console.error("打开链接失败:", err);
      toast({ title: "打不开链接", description: url, variant: "destructive" });
    }
  };

  const handleAddToShortcut = async (record: ClipboardRecord, url: string) => {
    try {
      const result = await window.electron.shortcutAdd({ kind: "url", target: url });
      if (!result.success) {
        toast({ title: "添加失败", description: result.error, variant: "destructive" });
        return;
      }
      toast({ title: "已添加到快捷方式", description: url });
    } catch (err) {
      console.error("添加到快捷方式失败:", err);
      toast({ title: "添加失败", variant: "destructive" });
    }
  };

  const handleSaveTodoFromClipboard = async (input: {
    title: string;
    notes?: string;
    priority: TodoPriority;
    due_date: string | null;
    attachments?: import("@/pages/todo/types").TodoAttachment[];
  }) => {
    try {
      await window.electron.todoCreate(input);
      toast({ title: "已添加到 Todo", description: `「${input.title.slice(0, 30)}${input.title.length > 30 ? "…" : ""}」` });
      setAddTodoAttachments([]);
    } catch (err) {
      console.error("创建 Todo 失败", err);
      toast({ title: "添加失败", description: err instanceof Error ? err.message : "未知错误", variant: "destructive" });
    }
  };

  const handleCloseAddTodoDialog = () => {
    setAddTodoDialogOpen(false);
    setAddTodoAttachments([]);
  };

  const currentImageRecord = dialogImage
    ? clipboardHistory.find((record) => record.content === dialogImage)
    : undefined;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden page-transition">
        <ClipboardToolbar
          searchKeyword={searchKeyword}
          onSearchChange={handleSearch}
          onDeleteAll={deleteAllRecords}
          clearDisabled={clipboardHistory.length === 0}
        />

        {clipboardHistory.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center animate-fade-in px-4">
            {searchKeyword ? (
              <>
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl scale-75" />
                  <div className="relative w-16 h-16 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center animate-float icon-glow-ring">
                    <SearchX className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <p className="text-base font-medium text-foreground/80 mb-1 animate-fade-in-stagger">
                  未找到匹配的记录
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs text-center animate-fade-in-stagger mb-4">
                  尝试换一个搜索关键词，或检查是否有内容被清空
                </p>
                <Button
                  onClick={() => setSearchKeyword("")}
                  variant="outline"
                  className="text-sm px-4 py-1.5 h-auto animate-fade-in-stagger border-primary/25 text-primary-strong bg-primary/10 hover:bg-primary/15 hover:text-primary-strong hover:border-primary/40 hover:scale-105 active:scale-95 transition-all duration-150"
                  style={{ animationDelay: '360ms' }}>
                  清除搜索
                </Button>
              </>
            ) : (
              <>
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl scale-75" />
                  <div className="relative w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center group">
                    <ClipboardListIcon className="h-8 w-8 text-primary animate-float transition-transform duration-300 group-hover:scale-110" />
                    <span className="absolute inset-0 rounded-2xl border-2 border-primary/20 animate-pulse-ring" />
                  </div>
                </div>
                <p className="text-base font-medium text-foreground/70 mb-1 animate-fade-in-stagger">
                  暂无记录
                </p>
                <p className="text-sm text-muted-foreground/70 leading-relaxed max-w-xs text-center animate-fade-in-stagger">
                  复制内容后会自动出现在这里，支持文本和图片
                </p>
                {}
                <div className="mt-3 animate-fade-in" style={{ animationDelay: '260ms' }}>
                  <div className="flex flex-col items-center gap-0.5 text-muted-foreground/25">
                    <span className="text-[10px] tracking-wide">粘贴内容</span>
                    <svg className="" width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2v8M2 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-3 animate-fade-in-stagger" style={{ animationDelay: '360ms' }}>
                  <kbd className="kbd-key">{isMac ? '⌘' : 'Ctrl'}</kbd>
                  <span className="text-muted-foreground/40 text-xs">+</span>
                  <kbd className="kbd-key">V</kbd>
                  <span className="text-xs text-muted-foreground/50">粘贴</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <ClipboardList
            clipboardHistory={clipboardHistory}
            formattedLanguages={formattedLanguages}
            formattingRecordId={formattingRecordId}
            onFormatCode={handleFormatCode}
            onCopy={copyToClipboard}
            onDeleteRecord={deleteRecord}
            onAddToVector={handleAddToMemory}
            onTogglePin={handleTogglePin}
            onToggleImportant={handleToggleImportant}
            onAddToTodo={handleAddToTodo}
            onOpenUrl={handleOpenUrl}
            onAddToShortcut={handleAddToShortcut}
            onSaveAsNote={handleSaveAsNote}
            savingNoteId={savingNoteId}
            onUpdateContent={handleUpdateContent}
            onImageClick={handleImageClick}
            codeContainerRef={codeContainerRef}
          />
        )}
      </div>
      {
}
      <ShortcutPanel />
      {}
      <ImageOcrDialog
        open={imageDialogOpen}
        dialogImage={dialogImage}
        ocrResult={ocrResult}
        ocrType={ocrType}
        ocrLoading={ocrLoading}
        onOpenChange={setImageDialogOpen}
        onOcrTypeChange={setOcrType}
        onOcrExtract={handleOcrExtract}
        onCopyResult={() => copyToClipboard(ocrResult)}
        onAddToVector={() => {
          if (currentImageRecord) {
            void handleAddToMemory(currentImageRecord);
          }
        }}
      />
      <DeleteAllConfirmDialog
        open={deleteAllDialogOpen}
        stats={clearStats}
        onConfirm={handleDeleteAllConfirm}
        onCancel={() => {
          setDeleteAllDialogOpen(false);
          setClearStats(null);
        }}
      />
      <TodoEditDialog
        open={addTodoDialogOpen}
        initialTitle={addTodoTitle}
        initialAttachments={addTodoAttachments}
        onClose={handleCloseAddTodoDialog}
        onSave={handleSaveTodoFromClipboard}
      />
    </div>
  );
}
