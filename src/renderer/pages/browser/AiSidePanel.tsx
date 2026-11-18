import { MessageSquarePlus, History, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAiAssistant } from "@/hooks/ai/useAiAssistant";
import { AiChatPanel } from "@/pages/ai/AiChatPanel";
import { AiChatSessionsPanel } from "@/pages/ai/AiChatSessionsPanel";
import { cn } from "@/lib/utils";

export function AiSidePanel() {
  const ai = useAiAssistant();

  return (
    <div className="flex flex-col h-full min-h-0 bg-card">
      {}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 flex-shrink-0">
        <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="text-xs font-medium flex-1 truncate">
          {ai.assistantView === "sessions"
            ? "AI 会话"
            : ai.activeChatSession?.title ?? "新建对话"}
        </span>

        {ai.assistantView === "sessions" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={ai.handleNewChat}
            disabled={ai.isCreatingSession}>
            <MessageSquarePlus className="h-3 w-3 mr-1" />
            新对话
          </Button>
        ) : (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="会话列表"
              aria-label="会话列表"
              onClick={ai.handleShowSessions}>
              <History className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="新建对话"
              aria-label="新建对话"
              onClick={ai.handleNewChat}
              disabled={ai.isCreatingSession}>
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {ai.assistantView === "sessions" ? (
          <AiChatSessionsPanel
            sessions={ai.chatSessions}
            isLoading={ai.sessionsLoading}
            isCreatingSession={ai.isCreatingSession}
            aiInput={ai.aiInput}
            aiLoading={ai.aiLoading}
            onNewChat={ai.handleNewChat}
            onSelectSession={ai.handleOpenChatSession}
            onDeleteSession={ai.handleDeleteChatSession}
            onInputChange={ai.setAiInput}
            onKeyDown={ai.handleKeyDown}
            onSendAiMessage={ai.handleSendAiMessage}
            aiImages={ai.aiImages}
            onAddAiImages={ai.addAiImages}
            onRemoveAiImage={ai.removeAiImage}
          />
        ) : (
          <AiChatPanel
            chatMessages={ai.chatMessages}
            aiInput={ai.aiInput}
            aiLoading={ai.aiLoading}
            isHistoryLoading={ai.chatHistoryLoading}
            streamingMessage={ai.streamingMessage}
            compacting={ai.compacting}
            pendingContinuation={ai.pendingContinuation}
            onContinueDecision={ai.handleContinueDecision}
            skills={ai.skills}
            activeSkillId={ai.activeSkillId}
            onSelectSkill={ai.setActiveSkillId}
            aiImages={ai.aiImages}
            onAddAiImages={ai.addAiImages}
            onRemoveAiImage={ai.removeAiImage}
            chatEndRef={ai.chatEndRef}
            onSendAiMessage={ai.handleSendAiMessage}
            onCancelAiMessage={ai.handleCancelAiMessage}
            onInputChange={ai.setAiInput}
            onKeyDown={ai.handleKeyDown}
            className={cn("bg-card")}
          />
        )}
      </div>
    </div>
  );
}
