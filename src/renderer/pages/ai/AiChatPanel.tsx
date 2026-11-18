import {
  type RefObject,
  useMemo,
  useState,
  useEffect,
  type KeyboardEvent,
  memo,
  useCallback,
} from "react";
import {
  Bot,
  User,
  Copy,
  Check,
  Wrench,
  Loader2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  ChevronRight,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatMessage } from "./types";
import type { AssistantBlock, ToolCallRecord } from "@shared/ai/aiBlocks";
import { aiImageDataUrl, type AiImageAttachment } from "@shared/ai/aiImages";
import type { StreamingMessage, AiSkill } from "@/hooks/ai/useAiAssistant";
import { AiComposer } from "./AiComposer";
import { cn } from "@/lib/utils";

interface AiChatPanelProps {
  chatMessages: ChatMessage[];
  aiInput: string;
  aiLoading: boolean;
  isHistoryLoading?: boolean;
  streamingMessage?: StreamingMessage | null;
  compacting?: { round: number; maxRounds: number } | null;
  pendingContinuation?: { sessionId: string; rounds: number; totalRounds: number } | null;
  onContinueDecision?: (decision: "continue" | "stop") => void;
  skills?: AiSkill[];
  activeSkillId?: string | null;
  onSelectSkill?: (skillId: string | null) => void;
  aiImages?: AiImageAttachment[];
  onAddAiImages?: (images: AiImageAttachment[]) => void;
  onRemoveAiImage?: (index: number) => void;
  onSendAiMessage: () => void;
  onCancelAiMessage?: () => void;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  chatEndRef: RefObject<HTMLDivElement>;
  className?: string;
}

export const AiChatPanel = memo(function AiChatPanel({
  chatMessages,
  aiInput,
  aiLoading,
  isHistoryLoading = false,
  streamingMessage,
  compacting,
  pendingContinuation,
  onContinueDecision,
  skills,
  activeSkillId,
  onSelectSkill,
  aiImages,
  onAddAiImages,
  onRemoveAiImage,
  onSendAiMessage,
  onCancelAiMessage,
  onInputChange,
  onKeyDown,
  chatEndRef,
  className,
}: AiChatPanelProps) {
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);

  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);

  const [previewImage, setPreviewImage] = useState<AiImageAttachment | null>(null);

  const handleCopyMessage = useCallback(async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsgId(msg.id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
    }
  }, []);

  const sortedMessages = useMemo(
    () =>
      [...chatMessages].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [chatMessages]
  );

  const isInputDisabled = aiLoading || isHistoryLoading;

  return (
    <TooltipProvider>
      <div
        className={
          "relative flex flex-col h-full overflow-hidden " +
          (className ?? "")
        }>
        {}
        <div className="p-3 border-b shrink-0 hidden">
          {}
        </div>

        {
}
        <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
          {}
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-6 z-[1] bg-gradient-to-b from-muted/40 to-transparent pointer-events-none"
          />
          {}
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 right-0 h-6 z-[1] bg-gradient-to-t from-muted/40 to-transparent pointer-events-none"
          />
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-card p-3 space-y-2 ai-message-scroll">
          {isHistoryLoading && sortedMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载对话中…
            </div>
          ) : sortedMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-2 animate-fade-in">
              {}
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
            sortedMessages.map((msg, index) => {
              const prevMsg = sortedMessages[index - 1];
              const isConsecutiveSameRole = prevMsg && prevMsg.role === msg.role;
              const isCopied = copiedMsgId === msg.id;
              const isHovered = hoveredMsgId === msg.id;
              const isLatest = index === sortedMessages.length - 1;
              return (
                <div
                  key={msg.id}
                  className={`flex w-full min-w-0 items-start gap-2 group_msg ${
                    isLatest ? "animate-slide-in-up" : ""
                  } ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  onMouseEnter={() => setHoveredMsgId(msg.id)}
                  onMouseLeave={() => setHoveredMsgId(null)}
                  style={{
                    marginTop:
                      index === 0
                        ? "0"
                        : isConsecutiveSameRole
                          ? "0.25rem"
                          : "0.5rem",
                  }}>
                  {}
                  {msg.role === "assistant" && <div className="w-1 flex-shrink-0" />}
                  <div className={`relative min-w-0 group ${msg.role === "user" ? "user-bubble-wrap max-w-[85%]" : "ai-bubble-wrap flex-1"}`}>
                    <div
                      className={`min-w-0 text-sm transition-all duration-200 ${
                        msg.role === "user"
                          ? "user-message-bubble rounded-2xl rounded-tr-sm rounded-bl-sm border border-primary/20 px-3 py-2 hover:shadow-sm"
                          : "ai-message-bubble ai-reply-plain"
                      }`}>
                      <div className="min-w-0">
                        {msg.role === "assistant" ? (
                          <AssistantReply blocks={msg.blocks} />
                        ) : (
                          <>
                            {msg.images && msg.images.length > 0 && (
                              <div className="mb-1.5 flex flex-wrap gap-1.5">
                                {msg.images.map((image, imageIndex) => (
                                  <button
                                    key={`${image.data}-${imageIndex}`}
                                    type="button"
                                    onClick={() => setPreviewImage(image)}
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
                            {msg.content && (
                              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.content}</div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-1.5 mt-1 -mb-0.5">
                        <button
                          onClick={() => handleCopyMessage(msg)}
                          title={isCopied ? "已复制" : "复制内容"}
                          aria-label={isCopied ? "已复制" : "复制消息内容"}
                          className={`
                            ai-msg-copy-btn w-5 h-5 rounded flex items-center justify-center flex-shrink-0
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
                            ${isCopied
                              ? "ai-msg-copy-btn copied"
                              : msg.role === "user"
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
                          {getTimestampLabel(new Date(msg.created_at))}
                        </span>
                      </div>
                    </div>
                  </div>
                  {msg.role === "user" && !isConsecutiveSameRole && (
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-1 animate-pop-in">
                      <User className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  {msg.role === "user" && isConsecutiveSameRole && (
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
                  frozen={Boolean(pendingContinuation)}
                />
                {pendingContinuation && (
                  <div className="mt-3 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2.5 animate-fade-in">
                    <p className="text-xs text-foreground/80">
                      达到单次运行的安全上限（{pendingContinuation.rounds} 轮）
                      {pendingContinuation.totalRounds > pendingContinuation.rounds &&
                        `，本次提问累计已跑 ${pendingContinuation.totalRounds} 轮`}
                      ，是否继续？
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => onContinueDecision?.("continue")}
                        className="h-7 px-3 text-xs">
                        继续
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onContinueDecision?.("stop")}
                        className="h-7 px-3 text-xs">
                        就到这里
                      </Button>
                    </div>
                  </div>
                )}
                {onCancelAiMessage && !pendingContinuation && (
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
          <div ref={chatEndRef} />
          </div>
        </div>

        {}
        <div className="sticky bottom-0 z-[2] shrink-0 border-t border-border/60 p-3 pt-2.5 animate-slide-in-up backdrop-blur-sm ai-input-separator bg-gradient-to-t from-muted/65 via-muted/40 to-muted/10">
          {}
          {skills && skills.length > 0 && onSelectSkill && (
            <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-0.5 ai-skill-row">
              <button
                type="button"
                onClick={() => onSelectSkill(null)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors",
                  activeSkillId === null
                    ? "bg-muted text-muted-foreground/70 border-border"
                    : "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50"
                )}
                title="不使用任何技能">
                无技能
              </button>
              {skills.map((skill) => {
                const active = activeSkillId === skill.id;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => onSelectSkill(active ? null : skill.id)}
                    title={skill.content}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors",
                      active
                        ? "bg-primary/10 text-primary-strong border-primary/25"
                        : "bg-muted/60 text-muted-foreground/80 border-border hover:bg-muted"
                    )}>
                    <Sparkles className="h-2.5 w-2.5" />
                    <span className="max-w-[100px] truncate">{skill.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {
}
          <AiComposer
            value={aiInput}
            onValueChange={onInputChange}
            onSubmit={onSendAiMessage}
            onKeyDown={onKeyDown}
            placeholder="基于剪贴板内容提问..."
            ariaLabel="发起提问"
            disabled={isInputDisabled}
            busy={aiLoading}
            canStop={Boolean(onCancelAiMessage)}
            onStop={onCancelAiMessage}
            submitLabel="发送消息"
            images={aiImages}
            onAddImages={onAddAiImages}
            onRemoveImage={onRemoveAiImage}
          />
        </div>

        {
}
        {previewImage && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/90 backdrop-blur-sm animate-fade-in">
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              aria-label="关闭预览"
              className="absolute inset-0 h-full w-full cursor-zoom-out" />
            <img
              src={aiImageDataUrl(previewImage)}
              alt={previewImage.name || "附件图片"}
              className="max-h-full max-w-full object-contain p-4"
              draggable={false}
            />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              aria-label="关闭预览"
              title="关闭"
              className="absolute right-3 top-3 h-7 w-7 rounded-full bg-muted/80 border border-border/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});

function getTimestampLabel(date: Date): string {
  const now = new Date();
  const d = new Date(date);
  const todayStr = format(now, "yyyy-MM-dd");
  const dateStr = format(d, "yyyy-MM-dd");

  if (dateStr === todayStr) return `今天 ${format(d, "HH:mm")}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dateStr === format(yesterday, "yyyy-MM-dd")) return `昨天 ${format(d, "HH:mm")}`;

  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    const weekdays = "周日周一周二周三周四周五周六".split("");
    return `${weekdays[d.getDay()]} ${format(d, "HH:mm")}`;
  }
  return format(d, "MM-dd HH:mm");
}

function AssistantReply({
  blocks,
  streaming = false,
  frozen = false,
}: {
  blocks?: AssistantBlock[];
  streaming?: boolean;
  frozen?: boolean;
}) {
  const list = blocks ?? [];

  if (list.length === 0) {
    return streaming ? (
      <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-primary animate-ai-caret" />
    ) : null;
  }

  const thinkingCount = list.filter((b) => b.kind === "thinking").length;
  const toolCount = list.filter((b) => b.kind === "tool").length;

  return (
    <div className="min-w-0 text-sm [overflow-wrap:anywhere] space-y-1">
      {}
      {(thinkingCount > 0 || toolCount > 0) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
          <Sparkles className="h-3 w-3 flex-shrink-0 opacity-70" />
          {thinkingCount > 0 && <span>思考 {thinkingCount} 次</span>}
          {thinkingCount > 0 && toolCount > 0 && <span>，</span>}
          {toolCount > 0 && <span>执行 {toolCount} 条工具</span>}
        </div>
      )}
      {list.map((block, i) => {
        if (block.kind === "thinking") {
          return (
            <ThinkingBlock
              key={`t-${i}`}
              text={block.text}
              streaming={streaming && !frozen && i === list.length - 1}
            />
          );
        }
        if (block.kind === "tool") {
          return <ToolCallBlock key={`c-${block.call.id}-${i}`} call={block.call} />;
        }
        return (
          <div
            key={`x-${i}`}
            className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {block.text.trim()}
            {streaming && !frozen && i === list.length - 1 && (
              <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-primary ml-0.5 animate-ai-caret" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!streaming) return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  return (
    <div className="rounded-md border border-border/50 bg-muted/35 text-[11px] leading-relaxed text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left font-medium hover:text-foreground/80 transition-colors">
        <ChevronRight
          className={cn(
            "h-3 w-3 flex-shrink-0 transition-transform duration-200",
            open && "rotate-90"
          )}
        />
        <span>思考了 {seconds ?? Math.max(1, Math.round(text.length / 80))} 秒</span>
        {streaming && (
          <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-primary animate-ai-caret" />
        )}
      </button>
      {open && (
        <div className="px-2.5 pb-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {text.trim()}
        </div>
      )}
    </div>
  );
}

function toolSummary(name: string, args: Record<string, any>): string {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = args?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const short = (s: string) => (s.length > 48 ? `${s.slice(0, 48)}…` : s);

  switch (name) {
    case "save_note": return short(pick("title", "path") || "保存笔记");
    case "read_note": return short(pick("path") || "读取笔记");
    case "list_notes": return "列出笔记";
    case "remember": return short(pick("content") || "记住一条信息");
    case "recall": return "查看已记住的信息";
    case "forget": return short(pick("contains", "id") || "删除一条记忆");
    case "get_clipboard_history": return "读取剪贴板历史";
    case "get_todos": return "读取 Todo 列表";
    case "browser_navigate": return short(pick("url") || "打开页面");
    case "browser_click": return `点击元素 #${args?.index ?? "?"}`;
    case "browser_fill": return `填写 #${args?.index ?? "?"}`;
    default: return short(pick("title", "path", "url", "content", "query"));
  }
}

function PrettyJson({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/80">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}


function ToolCallBlock({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const isCalling = call.status === "calling";
  const isError = call.isError === true;
  const summary = toolSummary(call.name, call.args ?? {});

  return (
    <div className="rounded-md border border-border/60 overflow-hidden bg-muted/25 transition-colors hover:border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50">
        <ChevronRight
          className={cn(
            "h-3 w-3 flex-shrink-0 text-muted-foreground/70 transition-transform duration-200",
            open && "rotate-90"
          )}
        />
        {isError ? (
          <AlertCircle className="h-3 w-3 flex-shrink-0 text-destructive" />
        ) : isCalling ? (
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-primary-strong" />
        ) : (
          <Wrench className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" />
        )}
        <span className="font-mono text-[11px] font-semibold text-primary-strong flex-shrink-0">
          {call.name}
        </span>
        {summary && (
          <span className="text-[11px] text-muted-foreground truncate min-w-0">{summary}</span>
        )}
        {isCalling && (
          <span className="text-[10px] text-primary-strong flex-shrink-0">调用中…</span>
        )}
      </button>

      {open && (
        <>
          {Object.keys(call.args ?? {}).length > 0 && (
            <div className="px-2.5 py-2 border-t border-border/50">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                入参
              </div>
              <PrettyJson value={call.args} />
            </div>
          )}
          {call.result !== undefined && (
            <div className="px-2.5 py-2 border-t border-border/50 bg-background/40">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {isError ? "错误" : "结果"}
              </div>
              <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/80 max-h-56 overflow-y-auto">
                {call.result}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
