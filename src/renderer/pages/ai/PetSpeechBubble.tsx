import { Loader2, Mic, X } from "lucide-react";
import type { PetBubblePhase, PetBubbleState } from "@/hooks/ai/useAiAssistant";
import { cn } from "@/lib/utils";


export type { PetBubblePhase, PetBubbleState };

interface PetSpeechBubbleProps {
  state: PetBubbleState;
  level: number;
  onDismiss: () => void;
  tailOffset?: number;
  className?: string;
}

const BUBBLE_WIDTH = 300;
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
      {
}
      <span
        aria-hidden
        className="absolute -bottom-1.5 h-3 w-3 rotate-45 border-b border-r border-border/70 bg-card"
        style={{ right: `${tailOffset}px` }}
      />

      {
}
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

      {}
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

      {
}
      {state.phase === "listening" && (
        <div className="px-3 pb-3" aria-hidden>
          <div className="flex h-6 items-center justify-center gap-[3px]">
            {Array.from({ length: 22 }).map((_, index) => {
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

      {}
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

      {}
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
