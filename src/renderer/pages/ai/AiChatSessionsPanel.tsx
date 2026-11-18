import { useState, useEffect, type KeyboardEvent } from "react";
import { format } from "date-fns";
import { MessageSquareText, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBrowserSurface } from "@/hooks/browser/useBrowserSurface";
import { AiComposer } from "./AiComposer";
import type { AiChatSession } from "./types";
import type { AiImageAttachment } from "@shared/ai/aiImages";
import { buildSessionPreview } from "@shared/ai/aiSessionPreview";

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
  aiImages?: AiImageAttachment[];
  onAddAiImages?: (images: AiImageAttachment[]) => void;
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

  const isDeleteDialogOpen = sessionToDelete !== null;
  const surface = useBrowserSurface();
  useEffect(() => {
    if (isDeleteDialogOpen) {
      void surface.borrow();
    } else {
      void surface.release();
    }
  }, [isDeleteDialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSessions = sessions
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
      {
}
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
            <MessageSquareText className="h-8 w-8 text-muted-foreground" />
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
        {}
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

      {}
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