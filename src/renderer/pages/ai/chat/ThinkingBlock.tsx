import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
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
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left font-medium hover:text-foreground/80 transition-colors">
        <ChevronRight
          className={cn(
            "h-3 w-3 flex-shrink-0 transition-transform duration-200",
            open && "rotate-90"
          )}
        />
        <span>{seconds === null ? "思考过程" : `思考了 ${seconds} 秒`}</span>
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
