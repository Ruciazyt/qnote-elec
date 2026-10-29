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
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  ChevronRight,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "../ui/button";
import { TooltipProvider } from "../ui/tooltip";
import { ChatMessage } from "./types";
import type { AssistantBlock, ToolCallRecord } from "@shared/aiBlocks";
import { aiImageDataUrl, type AiImageAttachment } from "@shared/aiImages";
import type { StreamingMessage, AiSkill } from "@/hooks/useAiAssistant";
import { AiComposer } from "./AiComposer";
import { cn } from "@/lib/utils";

interface AiChatPanelProps {
  /** 移除折叠态后只剩展开态 UI */
  chatMessages: ChatMessage[];
  aiInput: string;
  aiLoading: boolean;
  isHistoryLoading?: boolean;
  /**
   * 当前正在累积的流式消息；非 null 时渲染为最后一条带打字光标的占位
   * 不传则组件维持旧版"思考中..."回退（向后兼容未升级的调用方）
   */
  streamingMessage?: StreamingMessage | null;
  /**
   * 会话压缩进度；非 null 时显示「正在压缩对话历史…」
   *
   * 压缩是阻塞的（要等摘要生成完才继续），期间没有 chunk 流出。
   * 没有这个提示用户只会看到界面不动 —— 而应用此时正在改写他们的
   * 对话历史，这种行为不告知是不行的。
   */
  compacting?: { round: number; maxRounds: number } | null;
  /** 撞上轮次上限，等待用户决定（null = 没有待决的续跑） */
  pendingContinuation?: { sessionId: string; rounds: number; totalRounds: number } | null;
  /** 回答「是否继续」 */
  onContinueDecision?: (decision: "continue" | "stop") => void;
  /** Skill：可用技能列表 */
  skills?: AiSkill[];
  /** Skill：当前选中的技能 id（null = 不使用） */
  activeSkillId?: string | null;
  /** Skill：切换选中的技能（传 null 表示取消选中） */
  onSelectSkill?: (skillId: string | null) => void;
  /** Latest clipboard text content — shown as contextual prompt in empty state */
  latestClipboardContent?: string;
  /** 待发送的图片附件（输入框里的预览条） */
  aiImages?: AiImageAttachment[];
  /** 追加图片附件 */
  onAddAiImages?: (images: AiImageAttachment[]) => void;
  /** 移除图片附件 */
  onRemoveAiImage?: (index: number) => void;
  onSendAiMessage: () => void;
  /** 用户中途取消。不传则在流式期间不显示取消按钮 */
  onCancelAiMessage?: () => void;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  chatEndRef: RefObject<HTMLDivElement>;
  /** 容器额外 class — 浮框模式下需要覆盖默认背景/边框 */
  className?: string;
}

/**
 * AI 助手聊天面板 — **展开态纯 UI**
 *
 * 设计前提：折叠态（左侧窄条）已废弃，由 FloatingAiAssistant 接管全局浮框的
 * 球/卡片切换。本组件只负责"已展开的聊天界面"渲染。
 *
 * 用法：
 * - 浮框模式：被 FloatingAiAssistant 包在一个 floating card 内
 * - 历史兼容：之前 HomePage 直接嵌入也仍可工作（会占满父容器高度）
 */
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
  // Track which message is copied (for copy-to-clipboard feedback)
  const [copiedMsgId, setCopiedMsgId] = useState<number | null>(null);

  // Track which message is hovered (for timestamp reveal)
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);

  /**
   * 正在放大查看的图片
   *
   * 用面板内的绝对定位浮层，而不是 Dialog ——
   * 这个面板在浏览器侧栏里时，下面的网页是原生视图（WebContentsView），
   * 任何居中的弹窗都会被它盖住。面板内浮层只覆盖面板自己，天然没这个问题。
   */
  const [previewImage, setPreviewImage] = useState<AiImageAttachment | null>(null);

  const handleCopyMessage = useCallback(async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsgId(msg.id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // silently fail — user can still select text
    }
  }, []);

  // Always call useMemo first to maintain consistent hook order
  const sortedMessages = useMemo(
    () =>
      [...chatMessages].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [chatMessages]
  );

  // 输入区在加载历史/生成中整体停用 —— 具体输入框长什么样见 AiComposer
  const isInputDisabled = aiLoading || isHistoryLoading;

  // latestClipboardContent 仍作为 prop 接收但暂未在空状态使用，预留给后续扩展

  return (
    <TooltipProvider>
      <div
        className={
          // 移除默认的 bg-muted/30 — 背景由调用方显式控制（FloatingAiAssistant 传 bg-card，
          // 旧 HomePage 直接嵌入时父容器是 bg-background，自然透过来）
          "relative flex flex-col h-full overflow-hidden " +
          (className ?? "")
        }>
        {/* 头部 — 仅在浮框模式下由 FloatingAiAssistant 提供，这里保留一个轻量 header 作为占位 */}
        <div className="p-3 border-b shrink-0 hidden">
          {/* 隐藏占位 — 浮框模式下由外部 wrapper 渲染实际 header */}
        </div>

        {/* 消息列表
            渐变遮罩放在滚动容器**外面**的 relative 包裹层（和 ClipboardList 同款做法）：
            absolute 定位在滚动容器内会跟着内容一起滚走，于是「顶部有一道灰、
            底部没有」会随滚动位置来回变，看起来就是背景色断了。放到外面才钉在视口边缘。 */}
        <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
          {/* Top fade gradient */}
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-6 z-[1] bg-gradient-to-b from-muted/40 to-transparent pointer-events-none"
          />
          {/* Bottom fade gradient */}
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
              {/* 装饰背景 — 去掉持续浮动 + 模糊光晕，简化静态 */}
              <div className="relative mb-5">
                <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Bot className="h-8 w-8 text-primary/70" />
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
                  {/* AI 侧不占头像列：内容左对齐平铺，和用户气泡（右侧）形成区分 */}
                  {msg.role === "assistant" && <div className="w-1 flex-shrink-0" />}
                  <div className={`relative min-w-0 group ${msg.role === "user" ? "user-bubble-wrap max-w-[85%]" : "ai-bubble-wrap flex-1"}`}>
                    <div
                      className={`min-w-0 text-sm transition-all duration-200 ${
                        msg.role === "user"
                          ? "user-message-bubble rounded-2xl rounded-tr-sm rounded-bl-sm border border-primary/20 px-3 py-2 hover:shadow-sm"
                          // AI 侧不画气泡、不画边框。ai-message-bubble 必须留着（复制按钮靠它
                          // 做 hover 作用域），外框由 ai-reply-plain 抹掉。
                          : "ai-message-bubble ai-reply-plain"
                      }`}>
                      <div className="min-w-0">
                        {msg.role === "assistant" ? (
                          <AssistantReply blocks={msg.blocks} />
                        ) : (
                          <>
                            {msg.images && msg.images.length > 0 && (
                              /* 用户带上的图 —— 显示在文字上方，点一下放大 */
                              <div className="mb-1.5 flex flex-wrap gap-1.5">
                                {msg.images.map((image, imageIndex) => (
                                  <button
                                    key={`${image.data}-${imageIndex}`}
                                    type="button"
                                    onClick={() => setPreviewImage(image)}
                                    title={image.name || "查看图片"}
                                    aria-label="查看图片"
                                    className="overflow-hidden rounded-md border border-border/60 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
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
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1
                            ${isCopied
                              ? "ai-msg-copy-btn copied"
                              : msg.role === "user"
                                ? "bg-primary-foreground/15 dark:bg-primary-foreground/20 border border-primary-foreground/25 text-primary-foreground/70"
                                : "bg-background/70 dark:bg-muted/60 border border-border/60 text-muted-foreground/60"
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
            /* 流式输出占位消息 + 闪烁光标。
               撞上轮次上限时 streamingMessage 是**保留**的（已流出的正文和工具块
               要留在屏幕上），所以「是否继续」的提示必须渲染在这一支内部 ——
               之前把它放在 : streamingMessage 之后，永远走不到。 */
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
                      本轮已达上限（{pendingContinuation.rounds} 轮）
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
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground/60">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    正在生成…
                  </div>
                )}
              </div>
            </div>
          ) : aiLoading ? (
            /* 压缩中 —— 优先于「思考中」显示。
               压缩阶段不流出任何 chunk，若只显示思考动画，用户会以为模型卡住了；
               实际上应用正在把早期对话摘要化。这个状态必须说清楚，否则
               「应用在丢弃历史」就成了不可见的黑盒行为。 */
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
                  <span className="text-[10px] text-muted-foreground/60 leading-relaxed">
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
              // 兼容老路径：未升级 useAiAssistant 时仍显示思考中动画
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

        {/* 输入区 — 浮框模式下也被外部 wrapper 使用，本组件始终保留以便兼容直接嵌入场景 */}
        <div className="sticky bottom-0 z-[2] shrink-0 border-t border-border/60 p-3 pt-2.5 animate-slide-in-up backdrop-blur-sm ai-input-separator bg-gradient-to-t from-muted/65 via-muted/40 to-muted/10">
          {/* Skill 选择器 — 横向滚动的芯片行 */}
          {skills && skills.length > 0 && onSelectSkill && (
            <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-0.5 ai-skill-row">
              <button
                type="button"
                onClick={() => onSelectSkill(null)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors",
                  activeSkillId === null
                    ? "bg-muted text-muted-foreground/70 border-border"
                    : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
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
                        ? "bg-primary/10 text-primary border-primary/25"
                        : "bg-muted/60 text-muted-foreground/80 border-border hover:bg-muted"
                    )}>
                    <Sparkles className="h-2.5 w-2.5" />
                    <span className="max-w-[100px] truncate">{skill.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/*
           * 输入框本体在 AiComposer —— 与会话列表、浏览器侧栏、右下角浮窗共用同一份，
           * 这里只负责它上方那一排技能芯片。改输入框的样式/尺寸只改那一处。
           */}
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

        {/*
         * 图片放大浮层 —— 盖住整个面板，点任意处关闭。
         *
         * 不用 Dialog 的原因见 previewImage 的注释：浏览器侧栏里的
         * 居中弹窗会被下面的原生网页视图盖住。
         */}
        {previewImage && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-background/90 backdrop-blur-sm animate-fade-in"
            onClick={() => setPreviewImage(null)}
            role="dialog"
            aria-label="查看图片">
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

/**
 * Format timestamp with day-of-week context
 * Today: "今天 HH:mm" · Yesterday: "昨天 HH:mm" · Within week: "周X HH:mm" · Older: "MM-dd HH:mm"
 */
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

/**
 * AI 回复的正文渲染 —— 按 blocks 的**真实顺序**依次渲染
 *
 * 三种块：思考（折叠）→ 工具调用（折叠面板）→ 输出正文。
 * 没有头像、没有气泡，内容左对齐平铺，像主流 AI 客户端那样。
 *
 * 不做降级：blocks 为空就是没有内容（老会话没有这一列，直接重建一个）。
 */
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
      {/* 紧凑摘要行：这一轮想了多少次、调了几次工具 */}
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

/** 思考块 —— 默认折叠，标题上带耗时 */
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

  // 折叠状态下同步展开态：正在想就展开，想完了自动收起
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

/**
 * 工具名 → 一句话摘要
 *
 * Claude Code 那种「Bash  Check parsePartialJson tolerance」的读法：
 * 光有工具名不够，得让人一眼知道这次调用干了什么。
 */
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

/** 结果面板里 JSON 缩进显示，太长就横向滚动而不是把卡片撑到失控 */
function PrettyJson({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/80">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}


/**
 * 工具调用块 —— 一个工具一块
 *
 * 头部一行「工具名 + 摘要」，点开看入参和结果；默认折叠，不打断阅读。
 */
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
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-primary" />
        ) : (
          <Wrench className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" />
        )}
        <span className="font-mono text-[11px] font-semibold text-primary flex-shrink-0">
          {call.name}
        </span>
        {summary && (
          <span className="text-[11px] text-muted-foreground truncate min-w-0">{summary}</span>
        )}
        {isCalling && (
          <span className="text-[10px] text-primary/70 flex-shrink-0">调用中…</span>
        )}
      </button>

      {open && (
        <>
          {Object.keys(call.args ?? {}).length > 0 && (
            <div className="px-2.5 py-2 border-t border-border/50">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                入参
              </div>
              <PrettyJson value={call.args} />
            </div>
          )}
          {call.result !== undefined && (
            <div className="px-2.5 py-2 border-t border-border/50 bg-background/40">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
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
