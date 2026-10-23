import { useEffect, useRef, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, Mic, Square } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const AI_INPUT_MAX = 2000;

interface AiComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  ariaLabel: string;
  /** 输入区整体不可用（加载中 / 建会话中）；同时让整个框降透明度 */
  disabled?: boolean;
  /** 正在生成 —— 与 canStop 同时为真时按钮切红色停止态 */
  busy?: boolean;
  /** 是否提供「停止生成」 */
  canStop?: boolean;
  onStop?: () => void;
  /** 发送按钮的无障碍文案，两处场景语义不同（发送消息 / 发送并新建对话） */
  submitLabel?: string;
}

/**
 * AI 输入框 —— 全应用**唯一**的一份实现
 *
 * 这个组件被四个位置同时使用：浏览器侧栏的会话列表页 / 对话页，
 * 以及右下角浮窗弹出的卡片里的同样两个页面。四处此前各抄了一份 JSX，
 * 于是很快漂移：会话列表那份没有 Tooltip、没有按压反馈，计数器也不带状态色。
 * 抽出来之后，"侧栏里的输入框"和"弹窗里的输入框"不再可能是两个样子 ——
 * 它们是同一个组件的两次渲染。
 *
 * 尺寸约定（改这里等于同时改四个位置）：
 *   · 框高 = py-2×2 + 单行 20px + 上下边框 2px = 38px，随内容向下长
 *   · 发送按钮 h-7 w-7 贴在框内右下角，文字右侧固定留 pr-11
 *   · 计数器与按钮同处底边一排，出现时把正文左侧让到 pl-20
 */
export function AiComposer({
  value,
  onValueChange,
  onSubmit,
  onKeyDown,
  placeholder,
  ariaLabel,
  disabled = false,
  busy = false,
  canStop = false,
  onStop,
  submitLabel = "发送消息",
}: AiComposerProps) {
  // 换行 + 随内容长高，而不是一路向右推、逼用户横向滚动
  const inputRef = useAutoGrowTextarea(value);

  /**
   * 语音输入
   *
   * 识别结果只**填进输入框**，不自动发送 ——
   * 语音转写难免有错字（专有名词、数字尤其明显），自动发出去等于替用户
   * 做了一次不可撤销的决定。填进输入框让他扫一眼再发，是更安全的默认。
   */
  const voice = useVoiceInput({
    onTranscribed: (text) => {
      onValueChange(value.trim() ? `${value.trim()} ${text}` : text);
    },
  });

  // 识别错误统一走 toast：输入框里塞一行红字会把本来就窄的框挤变形，
  // 而且和"AI 回复失败"这类消息混在一起时分不清是谁出的问题。
  const lastReportedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (voice.error && voice.error !== lastReportedErrorRef.current) {
      lastReportedErrorRef.current = voice.error;
      toast({ title: "语音识别失败", description: voice.error, variant: "destructive" });
    }
    if (!voice.error) {
      lastReportedErrorRef.current = null;
    }
  }, [voice.error]);

  const charCount = value.length;
  const isAtLimit = charCount >= AI_INPUT_MAX;
  const isNearLimit = charCount >= AI_INPUT_MAX * 0.85;
  // 计数器平时完全隐藏，只有快写满时才冒出来提示 —— 0/2000 这种常驻读数
  // 是纯噪音，主流输入框都不这么做
  const counterClass = isAtLimit
    ? "ai-char-counter at-limit"
    : isNearLimit
      ? "ai-char-counter near-limit"
      : "ai-char-counter";

  const isStopMode = busy && canStop;
  // 停止态下按钮必须可点，否则"正在生成"就变成了无法打断的死局
  const isButtonDisabled = isStopMode
    ? false
    : disabled || !value.trim() || isAtLimit;

  const handleClick = () => {
    if (isStopMode) {
      onStop?.();
      return;
    }
    onSubmit();
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          "relative rounded-lg border bg-background transition-colors",
          "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20",
          disabled && "opacity-60"
        )}>
        <Textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          maxLength={AI_INPUT_MAX}
          className={cn(
            // 最小高度 120px —— 空内容时也保持一个大框（用户确认的预期）。
            //
            // 原来是 min-h-0 + max-h-120px，空的时候塌成单行 36px。
            // 单行框的问题不只是"矮"：它把"这是一个可以写长句子的地方"
            // 这个信号藏掉了，而 AI 输入框恰恰最常写长句。
            //
            // min-height 在 CSS 里**压过** height，所以 useAutoGrowTextarea
            // 那句 el.style.height = scrollHeight 依然照常执行：
            // 空内容写 36px → 被 min 抬回 120px；
            // 内容多了写更大的值 → 从 120px 往上长。
            // 两边不冲突，不需要去改那个 hook。
            "max-h-[200px] min-h-[120px] w-full resize-none border-0 bg-transparent",
            // pr-20：给「麦克风 + 发送」两个 28px 按钮 + 间距留位。
            // 从 pr-11 调到 pr-20 是因为右下角现在有两个按钮，
            // 只留一个的宽度会让长文本压到发送按钮底下。
            "px-3 py-2 pr-20 text-sm leading-5",
            "shadow-none outline-none focus-visible:ring-0 disabled:cursor-not-allowed",
            // 计数器和发送按钮同处底边一排，出现时给左边让出位置
            isNearLimit && "pl-20"
          )}
        />
        {isNearLimit && (
          <span
            className={cn(
              "pointer-events-none absolute bottom-2 left-3 select-none",
              counterClass
            )}>
            {charCount}/{AI_INPUT_MAX}
          </span>
        )}

        {/*
         * 语音输入按钮。
         *
         * 与宠物气泡共用 useVoiceInput，语义完全一致：点一下开始录，
         * 再点一下结束并识别。识别结果会填进上面的输入框而非自动发送。
         *
         * 录音态必须有**换图标**，不能只靠变色。
         * 只变红的话，红色在暗色主题里和普通文字区分度有限，
         * 用户扫一眼根本看不出"已经在录了"—— 直到停止后迟迟没有反应，
         * 才发现刚才那句白说了。换成实心方块（与"停止生成"同一套符号语言）
         * 之后，图标本身就是状态：**麦克风 = 待机，方块 = 正在录/点我停**。
         *
         * 尺寸：麦克风用 !h-3 !w-3 而不是普通的 h-3 w-3。
         *
         * Button 基础样式里有 [&_svg]:size-4，它会编译成 `.btnClass svg{…}`，
         * 特异性 (0,1,1) **高于** svg 元素自身的 `.h-3`（(0,1,0)），
         * 所以直接写 h-3 w-3 是不生效的 —— 实测图标仍是 16px。
         * 必须用 `!` 抬到 !important 才能压过去。
         *
         * 为什么要压：SVG 元素盒统一 16px 并不代表图形本体一样大，
         * 图形大小取决于各图标路径在 24×24 viewBox 里的占比。
         * 实测 Mic 路径高 13.3px、ArrowUp 只有 9.3px，同为 16px 时并排，
         * 麦克风视觉上比发送箭头大 43%，一眼就是"没对齐"。
         * 降到 12px 后麦克风本体约 10px，与箭头 9.3px 基本齐平。
         */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="absolute bottom-2 right-11 inline-flex">
              <Button
                onClick={() => void voice.toggle()}
                disabled={disabled || voice.isTranscribing}
                size="icon"
                variant="ghost"
                aria-label={voice.isRecording ? "结束录音并识别" : "语音输入"}
                aria-pressed={voice.isRecording}
                title={voice.isRecording ? "结束录音并识别" : "语音输入"}
                className={cn(
                  "h-7 w-7 rounded-md active:scale-95",
                  "hover:bg-muted",
                  voice.isRecording && "bg-destructive/15 text-destructive hover:bg-destructive/20"
                )}
                style={
                  voice.isRecording
                    ? { transform: `scale(${1 + Math.min(voice.level, 1) * 0.14})` }
                    : undefined
                }>
                {voice.isTranscribing ? (
                  <Loader2 className="!h-3 !w-3 animate-spin" />
                ) : voice.isRecording ? (
                  /* 实心方块 = "正在录，点我停"。fill-current 让它和停止生成按钮同一套符号 */
                  <Square className="!h-3 !w-3 fill-current" />
                ) : (
                  <Mic className="!h-3 !w-3" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            <p className="text-xs">
              {voice.isRecording
                ? "正在录音，再次点击结束"
                : voice.isTranscribing
                  ? "识别中…"
                  : "语音输入"}
            </p>
          </TooltipContent>
        </Tooltip>

        {/*
         * 按钮外面必须包一层 <span>：disabled 的 button 不派发 pointer 事件，
         * 直接交给 TooltipTrigger 会导致"输入内容后发送"的提示永远出不来。
         * 绝对定位挂在 span 上，让它保留尺寸、继续接收 hover。
         */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="absolute bottom-2 right-2 inline-flex">
              <Button
                onClick={handleClick}
                disabled={isButtonDisabled}
                size="icon"
                variant={isStopMode ? "destructive" : "default"}
                aria-label={isStopMode ? "停止生成" : submitLabel}
                title={isStopMode ? "停止生成" : submitLabel}
                className={cn(
                  "h-7 w-7 rounded-md active:scale-95",
                  !isStopMode && "disabled:bg-muted disabled:text-muted-foreground/50"
                )}>
                {isStopMode ? (
                  <Square className="h-3 w-3 fill-current" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          {!isStopMode && isButtonDisabled && !disabled && (
            <TooltipContent side="top" sideOffset={6}>
              <p className="text-xs">输入内容后发送</p>
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}