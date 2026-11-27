import { useState } from "react";
import { AlertCircle, ChevronRight, Loader2, Wrench } from "lucide-react";
import type { ToolCallRecord } from "@shared/ai/aiBlocks";
import { cn } from "@/lib/utils";

function toolSummary(name: string, args: Record<string, any>): string {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = args?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const short = (value: string) => value.length > 48 ? `${value.slice(0, 48)}…` : value;

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

export function ToolCallBlock({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const isCalling = call.status === "calling";
  const isError = call.isError === true;
  const summary = toolSummary(call.name, call.args ?? {});

  return (
    <div className="rounded-md border border-border/60 overflow-hidden bg-muted/25 transition-colors hover:border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
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
        {call.title ? (
          <span className="text-[11px] font-semibold text-primary-strong flex-shrink-0">
            {call.title}
          </span>
        ) : (
          <span className="font-mono text-[11px] font-semibold text-primary-strong flex-shrink-0">
            {call.name}
          </span>
        )}
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
