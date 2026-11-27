import { Sparkles } from "lucide-react";
import type { AssistantBlock } from "@shared/ai/aiBlocks";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock } from "./ToolCallBlock";

export function AssistantReply({
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

  const thinkingCount = list.filter((block) => block.kind === "thinking").length;
  const toolCount = list.filter((block) => block.kind === "tool").length;

  return (
    <div className="min-w-0 text-sm [overflow-wrap:anywhere] space-y-1">
      {(thinkingCount > 0 || toolCount > 0) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
          <Sparkles className="h-3 w-3 flex-shrink-0 opacity-70" />
          {thinkingCount > 0 && <span>思考 {thinkingCount} 次</span>}
          {thinkingCount > 0 && toolCount > 0 && <span>，</span>}
          {toolCount > 0 && <span>执行 {toolCount} 条工具</span>}
        </div>
      )}
      {list.map((block, index) => {
        if (block.kind === "thinking") {
          return (
            <ThinkingBlock
              key={`thinking-${index}`}
              text={block.text}
              streaming={streaming && !frozen && index === list.length - 1}
            />
          );
        }
        if (block.kind === "tool") {
          return <ToolCallBlock key={`tool-${block.call.id}-${index}`} call={block.call} />;
        }
        return (
          <div key={`text-${index}`} className="min-w-0">
            <AssistantMarkdown text={block.text.trim()} />
            {streaming && !frozen && index === list.length - 1 && (
              <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-primary ml-0.5 animate-ai-caret" />
            )}
          </div>
        );
      })}
    </div>
  );
}
