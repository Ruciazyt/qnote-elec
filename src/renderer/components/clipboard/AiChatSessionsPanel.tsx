import { useState, useEffect, type KeyboardEvent } from "react";
import { format } from "date-fns";
import { MessageSquareText, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { useBrowserSurface } from "../../hooks/useBrowserSurface";
import { AiComposer } from "./AiComposer";
import type { AiChatSession } from "./types";
import type { AiImageAttachment } from "@shared/aiImages";
import { buildSessionPreview } from "../../../shared/aiSessionPreview";

interface AiChatSessionsPanelProps {
  sessions: AiChatSession[];
  isLoading: boolean;
  isCreatingSession: boolean;
  aiInput: string;
  aiLoading: boolean;
  onNewChat: () => void;
  onSelectSession: (session: AiChatSession) => void;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
  onInputChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendAiMessage: () => void;
  /** 待发送的图片附件（输入框里的预览条） */
  aiImages?: AiImageAttachment[];
  /** 追加图片附件 */
  onAddAiImages?: (images: AiImageAttachment[]) => void;
  /** 移除图片附件 */
  onRemoveAiImage?: (index: number) => void;
}

function formatSessionDate(value: Date): string {
  const date = new Date(value);
  const now = new Date();
  if (format(date, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")) {
    return `今天 ${format(date, "HH:mm")}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (format(date, "yyyy-MM-dd") === format(yesterday, "yyyy-MM-dd")) {
    return `昨天 ${format(date, "HH:mm")}`;
  }

  return format(date, "MM-dd HH:mm");
}

export function AiChatSessionsPanel({
  sessions,
  isLoading,
  isCreatingSession,
  aiInput,
  aiLoading,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onInputChange,
  onKeyDown,
  onSendAiMessage,
  aiImages,
  onAddAiImages,
  onRemoveAiImage,
}: AiChatSessionsPanelProps) {
  const [query, setQuery] = useState("");
  const [sessionToDelete, setSessionToDelete] = useState<AiChatSession | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  /**
   * 删除确认框需要借出浏览器的表层
   *
   * 这个确认框是居中弹窗（left-1/2 top-1/2），而 AI 侧栏在浏览器网页区**右侧**，
   * 所以弹窗必然落在网页区域内。网页由主进程 WebContentsView 承载，
   * 是 OS 合成器上的独立图层，z-index 压不住 —— 只能借出表层让它暂时不参与合成。
   *
   * 用 open 驱动而不是点击事件：确认框还可能由别处打开（键盘、程序化设置），
   * 挂在 open 上才不会漏。
   */
  const isDeleteDialogOpen = sessionToDelete !== null;
  const surface = useBrowserSurface();
  useEffect(() => {
    if (isDeleteDialogOpen) {
      void surface.borrow();
    } else {
      void surface.release();
    }
    // 只跟着开关走，borrow/release 本身是稳定的引用
  }, [isDeleteDialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSessions = sessions
    // 展示前再洗一次：DB 里可能还留着回填之前写入的老 preview，
    // 直接渲染会把模型的 <think> 推理过程暴露在列表里
    .map((session) => ({ ...session, preview: buildSessionPreview(session.preview) }))
    .filter((session) =>
      `${session.title} ${session.preview}`.toLocaleLowerCase().includes(normalizedQuery)
    );

  const handleConfirmDelete = async () => {
    if (!sessionToDelete || isDeletingSession) return;
    setIsDeletingSession(true);
    try {
      const deleted = await onDeleteSession(sessionToDelete.id);
      if (deleted) setSessionToDelete(null);
    } catch (error) {
      console.error("删除AI会话失败", error);
    } finally {
      setIsDeletingSession(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-card">
      {/*
       * 搜索栏 / 会话行 / 底部输入框共用同一条 12px 内容栏。
       * 计数原本是搜索框右侧的 flex 兄弟节点（gap-2 + 字宽 ≈ 14px），
       * 它会把输入框右缘往左挤，于是同一个面板里两个输入框一宽一窄、右侧对不齐。
       * 改成绝对定位贴在框内右端（输入框给 pr-9 让位），搜索框就能独占整栏。
       */}
      <div className="flex shrink-0 items-center border-b border-border/60 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话"
            aria-label="搜索对话"
            className="h-8 border-border/60 bg-background/70 pl-8 pr-9 text-xs"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 select-none text-[10px] tabular-nums text-muted-foreground">
            {sessions.length}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <MessageSquareText className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">还没有对话</p>
            <Button onClick={onNewChat} disabled={isCreatingSession} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              新建对话
            </Button>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            没有匹配的对话
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filteredSessions.map((session) => (
              /*
               * 行内边距 px-3 而不是 px-2：删除按钮原本比搜索框/输入框多探出 4px，
               * 一列控件出现三条不同的右缘。按钮自身的 px-1 同时去掉，
               * 让左侧图标正好落在 12px 内容栏上。
               */
              <div key={session.id} className="group flex items-center gap-1 rounded-md px-3 transition-colors hover:bg-muted/60 focus-within:bg-muted/60">
                <button
                  type="button"
                  onClick={() => onSelectSession(session)}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-md py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`打开对话：${session.title}`}>
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <MessageSquareText className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {session.title}
                      </span>
                      <time className="shrink-0 pt-0.5 text-[10px] text-muted-foreground">
                        {formatSessionDate(session.updated_at)}
                      </time>
                    </span>
                    <span className="mt-1 line-clamp-2 block break-words text-xs leading-relaxed text-muted-foreground">
                      {session.preview || "暂无消息"}
                    </span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
                  onClick={() => setSessionToDelete(session)}
                  aria-label={`删除对话：${session.title}`}
                  title="删除对话">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 p-3 pt-2.5 backdrop-blur-sm ai-input-separator bg-gradient-to-t from-muted/65 via-muted/40 to-muted/10">
        {/* 输入框本体在 AiComposer —— 与对话页、浏览器侧栏、右下角浮窗共用同一份 */}
        <AiComposer
          value={aiInput}
          onValueChange={onInputChange}
          onSubmit={onSendAiMessage}
          onKeyDown={onKeyDown}
          placeholder="发起一个新对话..."
          ariaLabel="发起新对话"
          disabled={aiLoading || isCreatingSession}
          submitLabel="发送并新建对话"
          images={aiImages}
          onAddImages={onAddAiImages}
          onRemoveImage={onRemoveAiImage}
        />
      </div>

      {/* 删除确认框打开时会借出网页表层，见上方 useBrowserSurface 说明 */}
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isDeletingSession) setSessionToDelete(null);
        }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除对话</DialogTitle>
            <DialogDescription>
              将删除“{sessionToDelete?.title}”及其全部消息，此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSessionToDelete(null)}
              disabled={isDeletingSession}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeletingSession}>
              {isDeletingSession ? "删除中…" : "删除对话"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}