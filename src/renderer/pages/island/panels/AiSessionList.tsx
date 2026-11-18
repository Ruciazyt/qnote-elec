import { useMemo, useState } from "react";
import { MessageSquareText, Plus, Search, Trash2 } from "lucide-react";
import type { AiChatSession } from "@/pages/ai/types";
import { buildSessionPreview } from "@shared/ai/aiSessionPreview";
import { sessionDateLabel } from "../format";

interface AiSessionListProps {
  sessions: AiChatSession[];
  isLoading: boolean;
  isCreatingSession: boolean;
  onSelectSession: (session: AiChatSession) => void;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
  onNewChat: () => void;
}

export function AiSessionList({
  sessions,
  isLoading,
  isCreatingSession,
  onSelectSession,
  onDeleteSession,
  onNewChat,
}: AiSessionListProps) {
  const [query, setQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSessions = useMemo(
    () =>
      sessions
        .map((session) => ({ ...session, preview: buildSessionPreview(session.preview) }))
        .filter((session) =>
          `${session.title} ${session.preview}`.toLocaleLowerCase().includes(normalizedQuery)
        ),
    [sessions, normalizedQuery]
  );

  const handleConfirmDelete = async (session: AiChatSession) => {
    if (deletingId) return;
    setDeletingId(session.id);
    try {
      const deleted = await onDeleteSession(session.id);
      if (deleted) setPendingDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="island-ai-list-wrap">
      <div className="island-ai-searchbox">
        <Search className="island-ai-search-icon" size={13} strokeWidth={2} />
        <input
          className="island-ai-search-input"
          value={query}
          placeholder="搜索对话"
          aria-label="搜索对话"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="island-ai-search-count">{sessions.length}</span>
      </div>

      <div className="island-ai-list">
        {isLoading && sessions.length === 0 ? (
          <div className="island-empty">
            <div className="island-empty-title">加载中…</div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="island-empty">
            <MessageSquareText size={22} strokeWidth={1.5} className="island-icon-muted" />
            <div className="island-empty-title">还没有对话</div>
            <button
              type="button"
              className="island-ai-new-btn"
              disabled={isCreatingSession}
              onClick={onNewChat}
            >
              <Plus size={13} strokeWidth={2} />
              {isCreatingSession ? "创建中…" : "新建对话"}
            </button>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="island-empty">
            <div className="island-empty-title">没有匹配的对话</div>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <div key={session.id} className="island-ai-session">
              {pendingDeleteId === session.id ? (
                <div className="island-ai-confirm">
                  <span className="island-ai-confirm-text">
                    删除「{session.title}」？
                  </span>
                  <div className="island-ai-confirm-actions">
                    <button
                      type="button"
                      className="island-ai-confirm-btn"
                      disabled={deletingId !== null}
                      onClick={() => setPendingDeleteId(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="island-ai-confirm-btn"
                      data-danger="true"
                      disabled={deletingId !== null}
                      onClick={() => void handleConfirmDelete(session)}
                    >
                      {deletingId === session.id ? "删除中…" : "删除"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="island-ai-session-open"
                    aria-label={`打开对话：${session.title}`}
                    onClick={() => onSelectSession(session)}
                  >
                    <span className="island-ai-session-icon">
                      <MessageSquareText size={13} strokeWidth={1.75} />
                    </span>
                    <span className="island-ai-session-main">
                      <span className="island-ai-session-head">
                        <span className="island-ai-session-title">{session.title}</span>
                        <time className="island-ai-session-time">
                          {sessionDateLabel(session.updated_at)}
                        </time>
                      </span>
                      <span className="island-ai-session-preview">
                        {session.preview || "暂无消息"}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="island-ai-session-del"
                    title="删除对话"
                    aria-label={`删除对话：${session.title}`}
                    onClick={() => setPendingDeleteId(session.id)}
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
