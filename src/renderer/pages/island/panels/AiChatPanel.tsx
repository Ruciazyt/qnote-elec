import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Bot, Plus, Square } from "lucide-react";
import type { IslandAiActivity } from "@shared/island/island";
import { useAiAssistant } from "@/hooks/ai/useAiAssistant";
import { useChatAutoScroll } from "@/hooks/ai/useChatAutoScroll";
import { elapsedDuration } from "../format";
import { AiSessionList } from "./AiSessionList";

interface AiChatPanelProps {
  activity: IslandAiActivity;
  onOpenMain: () => void;
}

const MAX_INPUT_HEIGHT = 76;

export function AiChatPanel({ activity, onOpenMain }: AiChatPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const handleStreamError = useCallback((message: string) => {
    setError(message);
  }, []);

  const {
    assistantView,
    chatSessions,
    activeChatSession,
    sessionsLoading,
    isCreatingSession,
    chatHistoryLoading,
    chatMessages,
    aiInput,
    aiLoading,
    streamingMessage,
    compacting,
    handleSendAiMessage,
    handleCancelAiMessage,
    handleKeyDown,
    handleNewChat,
    handleOpenChatSession,
    handleShowSessions,
    handleDeleteChatSession,
    setAiInput,
  } = useAiAssistant({ onError: handleStreamError });

  const isSessionsView = assistantView === "sessions";

  useEffect(() => {
    setError(null);
  }, [assistantView]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    const styles = window.getComputedStyle(element);
    const border =
      (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
    element.style.height = `${Math.min(element.scrollHeight + border, MAX_INPUT_HEIGHT)}px`;
  }, [aiInput]);

  const sortedMessages = useMemo(
    () =>
      [...chatMessages].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [chatMessages]
  );

  const ownStreamId = streamingMessage?.sessionId ?? null;
  const foreignActivity = useMemo(() => {
    if (!activity.running) return null;
    if (activity.sessionId && activity.sessionId === ownStreamId) return null;
    return activity;
  }, [activity, ownStreamId]);

  const canSend = aiInput.trim().length > 0 && !aiLoading;

  const { scrollRef, onScroll } = useChatAutoScroll(
    sortedMessages,
    streamingMessage,
    compacting
  );

  const send = useCallback(() => {
    if (!canSend) return;
    setError(null);
    void handleSendAiMessage();
  }, [canSend, handleSendAiMessage]);

  return (
    <div className="island-ai-panel">
      {foreignActivity ? (
        <div className="island-ai-status">
          <span className="island-ai-light" data-running="true" />
          <div className="flex-1 min-w-0">
            <div className="island-row-title">{foreignActivity.title || "正在处理…"}</div>
            <div className="island-row-meta">
              {foreignActivity.startedAt
                ? `已运行 ${elapsedDuration(Date.now() - foreignActivity.startedAt)}`
                : "正在运行"}
              {foreignActivity.tool ? ` · ${foreignActivity.tool}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="island-header-btn"
            title="停止这一轮"
            aria-label="停止这一轮"
            onClick={() => {
              if (foreignActivity.sessionId) {
                window.electron.cancelAiMessage(foreignActivity.sessionId);
              }
            }}
          >
            <Square size={13} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      {isSessionsView ? (
        <AiSessionList
          sessions={chatSessions}
          isLoading={sessionsLoading}
          isCreatingSession={isCreatingSession}
          onSelectSession={(session) => void handleOpenChatSession(session)}
          onDeleteSession={handleDeleteChatSession}
          onNewChat={() => void handleNewChat()}
        />
      ) : (
        <>
          <div className="island-ai-bar">
            <button
              type="button"
              className="island-header-btn"
              title="返回对话列表"
              aria-label="返回对话列表"
              onClick={handleShowSessions}
            >
              <ArrowLeft size={15} strokeWidth={1.75} />
            </button>
            <div className="island-ai-bar-title">
              {activeChatSession?.title || "新建对话"}
            </div>
            <button
              type="button"
              className="island-header-btn"
              title="新建对话"
              aria-label="新建对话"
              disabled={isCreatingSession}
              onClick={() => void handleNewChat()}
            >
              <Plus size={15} strokeWidth={1.75} />
            </button>
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="island-ai-messages">
            {chatHistoryLoading && sortedMessages.length === 0 ? (
              <div className="island-empty">
                <div className="island-empty-title">加载对话中…</div>
              </div>
            ) : sortedMessages.length === 0 && !streamingMessage ? (
              <div className="island-empty">
                <Bot size={22} strokeWidth={1.5} className="island-icon-muted" />
                <div className="island-empty-title">问点什么</div>
                <div className="island-empty-text">
                  和主窗口的助手是同一段对话，这里问的它接着看得到
                </div>
                <button type="button" className="island-link-btn" onClick={onOpenMain}>
                  打开助手
                </button>
              </div>
            ) : (
              <>
                {sortedMessages.map((message) => (
                  <div
                    key={message.id}
                    className="island-msg"
                    data-role={message.role === "user" ? "user" : "assistant"}
                  >
                    <div className="island-msg-body">{message.content}</div>
                  </div>
                ))}
                {streamingMessage ? (
                  <div className="island-msg" data-role="assistant">
                    <div className="island-msg-body">{streamingMessage.content}</div>
                    {!streamingMessage.content ? (
                      <span className="island-msg-caret" aria-label="正在回复" />
                    ) : null}
                  </div>
                ) : null}
                {compacting ? (
                  <div className="island-ai-hint">正在压缩对话历史…</div>
                ) : null}
              </>
            )}
            {error ? <div className="island-chat-error">{error}</div> : null}
          </div>
        </>
      )}

      <div className="island-ai-composer">
        <textarea
          ref={inputRef}
          className="island-chat-input"
          rows={1}
          value={aiInput}
          placeholder={isSessionsView ? "发起一个新对话…" : "问点什么…"}
          aria-label={isSessionsView ? "发起新对话" : "给 AI 发消息"}
          onChange={(event) => setAiInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {aiLoading ? (
          <button
            type="button"
            className="island-send-btn"
            data-stop="true"
            title="停止"
            aria-label="停止生成"
            onClick={handleCancelAiMessage}
          >
            <Square size={12} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            className="island-send-btn"
            title="发送"
            aria-label="发送"
            disabled={!canSend}
            onClick={send}
          >
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
