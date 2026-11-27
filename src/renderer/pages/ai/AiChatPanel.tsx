import {
  useMemo,
  useState,
  type KeyboardEvent,
  memo,
  useCallback,
} from "react";
import {
  X,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatMessage } from "./types";
import { aiImageDataUrl, type AiImageAttachment } from "@shared/ai/aiImages";
import type { StreamingMessage, AiSkill } from "@/hooks/ai/useAiAssistant";
import { ChatComposerArea } from "./chat/ChatComposerArea";
import { ChatMessageList } from "./chat/ChatMessageList";

interface AiChatPanelProps {
  chatMessages: ChatMessage[];
  aiInput: string;
  aiLoading: boolean;
  isHistoryLoading?: boolean;
  streamingMessage?: StreamingMessage | null;
  compacting?: { round: number; maxRounds: number } | null;
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
  className?: string;
}

export const AiChatPanel = memo(function AiChatPanel({
  chatMessages,
  aiInput,
  aiLoading,
  isHistoryLoading = false,
  streamingMessage,
  compacting,
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
        <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-6 z-[1] bg-gradient-to-b from-muted/40 to-transparent pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="absolute bottom-0 left-0 right-0 h-6 z-[1] bg-gradient-to-t from-muted/40 to-transparent pointer-events-none"
          />
          <ChatMessageList
            messages={sortedMessages}
            isHistoryLoading={isHistoryLoading}
            aiLoading={aiLoading}
            streamingMessage={streamingMessage}
            compacting={compacting}
            onCancelAiMessage={onCancelAiMessage}
            copiedMsgId={copiedMsgId}
            hoveredMsgId={hoveredMsgId}
            onCopyMessage={(message) => void handleCopyMessage(message)}
            onHoverMessage={setHoveredMsgId}
            onPreviewImage={setPreviewImage}
          />
        </div>

        <ChatComposerArea
          aiInput={aiInput}
          aiLoading={aiLoading}
          disabled={isInputDisabled}
          onInputChange={onInputChange}
          onSendAiMessage={onSendAiMessage}
          onKeyDown={onKeyDown}
          onCancelAiMessage={onCancelAiMessage}
          skills={skills}
          activeSkillId={activeSkillId}
          onSelectSkill={onSelectSkill}
          images={aiImages}
          onAddImages={onAddAiImages}
          onRemoveImage={onRemoveAiImage}
        />

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

