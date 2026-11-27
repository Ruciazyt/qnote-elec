import { Bot, Check, Copy, Loader2, RefreshCw, User } from "lucide-react";
import type { StreamingMessage } from "@/hooks/ai/useAiAssistant";
import { useChatAutoScroll } from "@/hooks/ai/useChatAutoScroll";
import type { AiImageAttachment } from "@shared/ai/aiImages";
import { aiImageDataUrl } from "@shared/ai/aiImages";
import type { ChatMessage } from "../types";
import { AssistantReply } from "./AssistantReply";
import { getTimestampLabel } from "./date";

interface ChatMessageListProps {
  messages: ChatMessage[];
  isHistoryLoading: boolean;
  aiLoading: boolean;
  streamingMessage?: StreamingMessage | null;
  compacting?: { round: number; maxRounds: number } | null;
  onCancelAiMessage?: () => void;
  copiedMsgId: number | null;
  hoveredMsgId: number | null;
  onCopyMessage: (message: ChatMessage) => void;
  onHoverMessage: (id: number | null) => void;
  onPreviewImage: (image: AiImageAttachment) => void;
}

export function ChatMessageList({
  messages,
  isHistoryLoading,
  aiLoading,
  streamingMessage,
  compacting,
  onCancelAiMessage,
  copiedMsgId,
  hoveredMsgId,
  onCopyMessage,
  onHoverMessage,
  onPreviewImage,
}: ChatMessageListProps) {
  const { scrollRef, onScroll } = useChatAutoScroll(messages, streamingMessage, compacting);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-card p-3 space-y-2 ai-message-scroll">
      {isHistoryLoading && messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          加载对话中…
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-2 animate-fade-in">
          <div className="relative mb-5">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary" />
            </div>
          </div>
          <div className="animate-fade-in-stagger text-center">
            <p className="text-sm font-semibold text-foreground/75 mb-1.5">开始与 AI 对话</p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              基于剪贴板内容提问
            </p>
          </div>
        </div>
      ) : (
        messages.map((message, index) => {
          const previous = messages[index - 1];
          const isConsecutiveSameRole = previous && previous.role === message.role;
          const isCopied = copiedMsgId === message.id;
          const isHovered = hoveredMsgId === message.id;
          const isLatest = index === messages.length - 1;

          return (
            <div
              key={message.id}
              className={`flex w-full min-w-0 items-start gap-2 group_msg ${
                isLatest ? "animate-slide-in-up" : ""
              } ${message.role === "user" ? "justify-end" : "justify-start"}`}
              onMouseEnter={() => onHoverMessage(message.id)}
              onMouseLeave={() => onHoverMessage(null)}
              style={{
                marginTop: index === 0
                  ? "0"
                  : isConsecutiveSameRole
                    ? "0.25rem"
                    : "0.5rem",
              }}>
              {message.role === "assistant" && <div className="w-1 flex-shrink-0" />}
              <div className={`relative min-w-0 group ${
                message.role === "user"
                  ? "user-bubble-wrap max-w-[85%]"
                  : "ai-bubble-wrap flex-1"
              }`}>
                <div className={`min-w-0 text-sm transition-all duration-200 ${
                  message.role === "user"
                    ? "user-message-bubble rounded-2xl rounded-tr-sm rounded-bl-sm border border-primary/20 px-3 py-2 hover:shadow-sm"
                    : "ai-message-bubble ai-reply-plain"
                }`}>
                  <div className="min-w-0">
                    {message.role === "assistant" ? (
                      <AssistantReply blocks={message.blocks} />
                    ) : (
                      <>
                        {message.images && message.images.length > 0 && (
                          <div className="mb-1.5 flex flex-wrap gap-1.5">
                            {message.images.map((image, imageIndex) => (
                              <button
                                key={`${image.data}-${imageIndex}`}
                                type="button"
                                onClick={() => onPreviewImage(image)}
                                title={image.name || "查看图片"}
                                aria-label="查看图片"
                                className="overflow-hidden rounded-md border border-border/60 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <img
                                  src={aiImageDataUrl(image)}
                                  alt={image.name || "附件图片"}
                                  className="max-h-40 max-w-[220px] object-cover"
                                  draggable={false}
                                />
                              </button>
                            ))}
                          </div>
                        )}
                        {message.content && (
                          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            {message.content}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1.5 mt-1 -mb-0.5">
                    <button
                      onClick={() => onCopyMessage(message)}
                      title={isCopied ? "已复制" : "复制内容"}
                      aria-label={isCopied ? "已复制" : "复制消息内容"}
                      className={`
                        ai-msg-copy-btn w-5 h-5 rounded flex items-center justify-center flex-shrink-0
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
                        ${isCopied
                          ? "ai-msg-copy-btn copied"
                          : message.role === "user"
                            ? "bg-primary-foreground/15 dark:bg-primary-foreground/20 border border-primary-foreground/25 text-primary-foreground"
                            : "bg-background/70 dark:bg-muted/60 border border-border/60 text-muted-foreground"
                        }
                      `}>
                      {isCopied ? (
                        <Check className="h-2.5 w-2.5 copy-success-check" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </button>
                    <span className={`ai-timestamp ${isHovered ? "visible" : ""} text-[10px]`}>
                      {getTimestampLabel(new Date(message.created_at))}
                    </span>
                  </div>
                </div>
              </div>
              {message.role === "user" && !isConsecutiveSameRole && (
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-1 animate-pop-in">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
              {message.role === "user" && isConsecutiveSameRole && (
                <div className="w-6 flex-shrink-0" />
              )}
            </div>
          );
        })
      )}
      {streamingMessage ? (
        <div
          className="flex w-full min-w-0 items-start ai-streaming-row"
          data-session-id={streamingMessage.sessionId}>
          <div className="w-1 flex-shrink-0" />
          <div className="min-w-0 flex-1 ai-message-bubble ai-reply-plain">
            <AssistantReply
              blocks={streamingMessage.blocks}
              streaming
              frozen={false}
            />
            {onCancelAiMessage && (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                正在生成…
              </div>
            )}
          </div>
        </div>
      ) : aiLoading ? (
        compacting ? (
          <div className="flex items-start gap-2 ai-thinking-row">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1 animate-pulse ai-thinking-avatar">
              <Bot className="h-3 w-3 text-primary" />
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 bg-background border border-border/80 shadow-sm ai-message-bubble ai-thinking-bubble thinking-glow flex flex-col items-start gap-1.5">
              <div className="flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 text-primary animate-spin" />
                <span className="text-xs font-medium text-foreground">正在压缩对话历史…</span>
              </div>
              <span className="text-[10px] text-muted-foreground leading-relaxed">
                对话较长，正在把早期内容总结成摘要以腾出空间。
                {compacting.maxRounds > 1 && (
                  <span className="tabular-nums">
                    （{Math.min(compacting.round + 1, compacting.maxRounds)}/{compacting.maxRounds}）
                  </span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 ai-thinking-row">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1 animate-pulse ai-thinking-avatar">
              <Bot className="h-3 w-3 text-primary" />
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 bg-background border border-border/80 shadow-sm ai-message-bubble ai-thinking-bubble thinking-glow flex flex-col items-start">
              <span className="typing-dots">
                <span className="typing-dot typing-dot-delay-0" />
                <span className="typing-dot typing-dot-delay-1" />
                <span className="typing-dot typing-dot-delay-2" />
              </span>
              <span className="ai-thinking-label">AI 思考中...</span>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
