import type { KeyboardEvent } from "react";
import { Sparkles } from "lucide-react";
import type { AiImageAttachment } from "@shared/ai/aiImages";
import type { AiSkill } from "@/hooks/ai/useAiAssistant";
import { cn } from "@/lib/utils";
import { AiComposer } from "../AiComposer";

interface ChatComposerAreaProps {
  aiInput: string;
  aiLoading: boolean;
  disabled: boolean;
  onInputChange: (value: string) => void;
  onSendAiMessage: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancelAiMessage?: () => void;
  skills?: AiSkill[];
  activeSkillId?: string | null;
  onSelectSkill?: (skillId: string | null) => void;
  images?: AiImageAttachment[];
  onAddImages?: (images: AiImageAttachment[]) => void;
  onRemoveImage?: (index: number) => void;
}

export function ChatComposerArea({
  aiInput,
  aiLoading,
  disabled,
  onInputChange,
  onSendAiMessage,
  onKeyDown,
  onCancelAiMessage,
  skills,
  activeSkillId,
  onSelectSkill,
  images,
  onAddImages,
  onRemoveImage,
}: ChatComposerAreaProps) {
  return (
    <div className="sticky bottom-0 z-[2] shrink-0 border-t border-border/60 p-3 pt-2.5 animate-slide-in-up backdrop-blur-sm ai-input-separator bg-gradient-to-t from-muted/65 via-muted/40 to-muted/10">
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
      <AiComposer
        value={aiInput}
        onValueChange={onInputChange}
        onSubmit={onSendAiMessage}
        onKeyDown={onKeyDown}
        placeholder="基于剪贴板内容提问..."
        ariaLabel="发起提问"
        disabled={disabled}
        busy={aiLoading}
        canStop={Boolean(onCancelAiMessage)}
        onStop={onCancelAiMessage}
        submitLabel="发送消息"
        images={images}
        onAddImages={onAddImages}
        onRemoveImage={onRemoveImage}
      />
    </div>
  );
}
