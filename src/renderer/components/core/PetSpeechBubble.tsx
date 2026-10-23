import { Loader2, Mic, X } from "lucide-react";
import type { PetBubblePhase, PetBubbleState } from "@/hooks/useAiAssistant";
import { cn } from "@/lib/utils";

/**
 * 宠物语音气泡 — 收起为宠物时的语音问答载体
 *
 * ## 与 AI 对话框的关系
 *
 * 这是**并行的第二条通路**，不是对话框的替代品：
 * - 快捷键触发时**不**展开 AI 对话框，用户视野里只有宠物和这个气泡
 * - 完整对话仍然照常落库、照常能在展开后的对话框里看到历史
 * - 气泡只呈现"这一轮"：听到什么 → AI 答什么
 *
 * ## 为什么只能手动关闭
 *
 * 用户明确要求"点击后才能关闭"。除了尊重这个要求，气泡本身也不适合自动消失：
 * 它承担的是语音问答的**唯一**反馈出口，AI 说的话可能需要几秒才说完，
 * 用户还需要时间读完 —— 自动关闭会让人永远读不完。
 *
 * 代价是气泡会挡住界面，所以关闭按钮做得显眼，且点击气泡**空白处**也能关
 * （不用精确瞄准那个 20px 的 X）。
 */

export type { PetBubblePhase, PetBubbleState };

interface PetSpeechBubbleProps {
  state: PetBubbleState;
  /** 麦克风电平 0~1，驱动"正在听"的呼吸效果 */
  level: number;
  onDismiss: () => void;
  /**
   * 尾巴距气泡右边缘的距离（px），由父级按宠物**实际**位置算好后传入。
   *
   * 不能写死：气泡右边缘为了不溢出视口会被夹动，一旦夹动，它与宠物右边缘就不再
   * 对齐，固定偏移的尾巴会指向宠物旁边的空气。父级必须把这段位移补进来。
   */
  tailOffset?: number;
  className?: string;
}

const BUBBLE_WIDTH = 300;
/** 未传入 tailOffset 时的兜底：BALL_SIZE(64) / 2，即气泡与宠物右对齐时宠物中心的偏移 */
const DEFAULT_TAIL_OFFSET = 32;

export function PetSpeechBubble({
  state,
  level,
  onDismiss,
  tailOffset = DEFAULT_TAIL_OFFSET,
  className,
}: PetSpeechBubbleProps) {
  const isBusy =
    state.phase === "listening" ||
    state.phase === "transcribing" ||
    state.phase === "thinking" ||
    state.phase === "streaming";
  const isFailed = state.phase === "error";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "bg-card border border-border/70 shadow-xl rounded-xl",
        "animate-in fade-in slide-in-from-bottom-2 zoom-in-95 origin-bottom-right duration-200",
        className
      )}
      style={{ width: BUBBLE_WIDTH }}>
      {/*
       * 小尾巴：指向宠物。水平位置由父级算好（气泡被视口夹动时尾巴要跟着平移），
       * 入场动画的变换原点同样放在尾巴这一侧，避免从错误的方向弹出。
       */}
      <span
        aria-hidden
        className="absolute -bottom-1.5 h-3 w-3 rotate-45 border-b border-r border-border/70 bg-card"
        style={{ right: `${tailOffset}px` }}
      />

      {/*
       * 关闭按钮常驻，但录音/生成中不隐藏 ——
       * 用户录音录到一半后悔了，必须有办法立刻中止，而不是被迫先听完。
       */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭气泡"
        className={cn(
          "absolute -top-2 -right-2 z-10 inline-flex h-6 w-6 items-center justify-center",
          "rounded-full border border-border bg-card text-muted-foreground shadow-sm",
          "transition-colors hover:bg-muted hover:text-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}>
        <X className="h-3 w-3" />
      </button>

      {/* 头部：状态指示 + 用户原话 */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
        <PhaseIcon phase={state.phase} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium leading-tight text-muted-foreground">
            {phaseLabel(state.phase)}
          </p>
          {state.utterance ? (
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-foreground/70">
              「{state.utterance}」
            </p>
          ) : null}
        </div>
      </div>

      {/* 录音时的电平条 —— 颜色之外再加一条形状通道，
          纯色反馈在静音环境下会让人以为坏了 */}
      {state.phase === "listening" && (
        <div className="px-3 pb-3" aria-hidden>
          <div className="flex h-6 items-center justify-center gap-[3px]">
            {Array.from({ length: 22 }).map((_, index) => {
              // 用 index 造一条固定的"波形"基线，再乘以实时电平，
              // 静止时是规律起伏，说话时被整体推高 —— 比纯进度条更像"在听"
              const baseline = 0.25 + 0.75 * Math.abs(Math.sin(index * 0.55));
              const height = Math.max(3, baseline * level * 24);
              return (
                <span
                  key={index}
                  className="w-[3px] rounded-full bg-primary/70 transition-[height] duration-75"
                  style={{ height: `${height}px` }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* AI 回复 / 错误 */}
      {(state.reply || isFailed) && (
        <div className="border-t border-border/50 px-3 py-2.5">
          {isFailed ? (
            <p className="text-xs leading-relaxed text-destructive">{state.error}</p>
          ) : (
            <p
              className={cn(
                "max-h-[220px] overflow-y-auto text-xs leading-relaxed text-foreground/90",
                "whitespace-pre-wrap break-words"
              )}>
              {state.reply}
            </p>
          )}
          {!isBusy && (
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              点击气泡任意处关闭
            </p>
          )}
        </div>
      )}

      {/* 空态提示：录音/识别阶段还没有内容时，给一句"现在该做什么" */}
      {isBusy && !state.reply && state.phase !== "listening" && (
        <div className="border-t border-border/50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <Loader2 className="h-3 w-3 animate-spin" />
            {state.phase === "transcribing" ? "正在识别…" : "正在思考…"}
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseIcon({ phase }: { phase: PetBubblePhase }) {
  if (phase === "listening") {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15">
        <Mic className="h-3 w-3 text-destructive" />
      </span>
    );
  }
  if (phase === "error") {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15">
        <X className="h-3 w-3 text-destructive" />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
    </span>
  );
}

function phaseLabel(phase: PetBubblePhase): string {
  switch (phase) {
    case "listening":
      return "正在听…";
    case "transcribing":
      return "识别中";
    case "thinking":
      return "已听到";
    case "streaming":
      return "正在回答";
    case "done":
      return "回答";
    case "error":
      return "出错了";
    default:
      return "";
  }
}

export { BUBBLE_WIDTH };
