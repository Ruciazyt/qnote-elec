import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { ArrowUp, ImagePlus, Loader2, Mic, Square, X } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useAutoGrowTextarea } from "@/hooks/ui/useAutoGrowTextarea";
import { useVoiceInput } from "@/hooks/ai/useVoiceInput";
import { toast } from "@/hooks/ui/use-toast";
import { cn } from "@/lib/utils";
import { AI_IMAGE_MAX_COUNT, aiImageDataUrl, type AiImageAttachment } from "@shared/ai/aiImages";
import { filesToAttachments, normalizeImageAttachment } from "@/utils/ai/imageAttachments";

export const AI_INPUT_MAX = 2000;
const COMPOSER_MAX_HEIGHT = 200;

interface AiComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  busy?: boolean;
  canStop?: boolean;
  onStop?: () => void;
  submitLabel?: string;
  images?: AiImageAttachment[];
  onAddImages?: (images: AiImageAttachment[]) => void;
  onRemoveImage?: (index: number) => void;
}

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
  images = [],
  onAddImages,
  onRemoveImage,
}: AiComposerProps) {
  const inputRef = useAutoGrowTextarea(value, COMPOSER_MAX_HEIGHT);

  const voice = useVoiceInput({
    onTranscribed: (text) => {
      onValueChange(value.trim() ? `${value.trim()} ${text}` : text);
    },
  });

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
  const counterClass = isAtLimit
    ? "ai-char-counter at-limit"
    : isNearLimit
      ? "ai-char-counter near-limit"
      : "ai-char-counter";

  const isStopMode = busy && canStop;
  const isButtonDisabled = isStopMode
    ? false
    : disabled || (!value.trim() && images.length === 0) || isAtLimit;

  const handleClick = () => {
    if (isStopMode) {
      onStop?.();
      return;
    }
    onSubmit();
  };


  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isPickingImages, setIsPickingImages] = useState(false);
  const dragDepthRef = useRef(0);

  const canAttachImages = Boolean(onAddImages) && !disabled;

  const hasDraggedFiles = (event: DragEvent<HTMLDivElement>): boolean => {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes("Files");
  };

  const addAttachments = (attachments: AiImageAttachment[]) => {
    if (!onAddImages || attachments.length === 0) return;

    const remaining = AI_IMAGE_MAX_COUNT - images.length;
    if (remaining <= 0) {
      toast({ title: `最多带 ${AI_IMAGE_MAX_COUNT} 张图`, description: "先移除一张再添加" });
      return;
    }
    if (attachments.length > remaining) {
      toast({
        title: `最多带 ${AI_IMAGE_MAX_COUNT} 张图`,
        description: `已添加前 ${remaining} 张`,
      });
    }
    onAddImages(attachments.slice(0, remaining));
  };

  const attachFiles = async (files: File[]) => {
    if (!canAttachImages || files.length === 0) return;
    const attachments = await filesToAttachments(files);
    if (attachments.length === 0) {
      toast({ title: "图片读取失败", description: "这个文件不是可用的图片", variant: "destructive" });
      return;
    }
    addAttachments(attachments);
  };

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canAttachImages) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    event.preventDefault();

    const files = imageItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;

    const plainText = event.clipboardData?.getData("text/plain") ?? "";
    if (plainText) {
      onValueChange(value ? `${value} ${plainText}` : plainText);
    }
    await attachFiles(files);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachImages) return;
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingOver(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachImages) return;
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachImages) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingOver(false);
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachImages) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingOver(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    await attachFiles(files);
  };

  const handlePickImages = async () => {
    if (!canAttachImages || isPickingImages) return;
    setIsPickingImages(true);
    try {
      const picked = await window.electron.pickAiImages();
      if (!picked || picked.length === 0) return;
      const attachments = await Promise.all(
        picked.map((image) => normalizeImageAttachment(image))
      );
      addAttachments(attachments);
    } catch (err) {
      console.error("选择图片失败:", err);
      toast({ title: "选择图片失败", description: "请稍后再试", variant: "destructive" });
    } finally {
      setIsPickingImages(false);
    }
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          "relative flex flex-col rounded-lg border bg-background transition-colors",
          "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20",
          disabled && "opacity-60",
          isDraggingOver && "border-primary/60 ring-2 ring-primary/25 bg-primary/[0.03]"
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((image, index) => (
              <div
                key={`${image.data}-${index}`}
                className="relative group h-16 w-16 rounded-md overflow-hidden border border-border/70 bg-muted/40">
                <img
                  src={aiImageDataUrl(image)}
                  alt={image.name || "附件图片"}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                {onRemoveImage && (
                  <button
                    type="button"
                    onClick={() => onRemoveImage(index)}
                    aria-label="移除图片"
                    title="移除图片"
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-background border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          rows={1}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          maxLength={AI_INPUT_MAX}
          className={cn(
            "max-h-[200px] min-h-[40px] w-full resize-none border-0 bg-transparent",
            "px-3 py-2 text-sm leading-5",
            "shadow-none outline-none focus-visible:ring-0 disabled:cursor-not-allowed"
          )}
        />

        {
}
        <div className="flex items-center gap-1 px-2 pb-2">
          {isNearLimit && (
            <span
              className={cn(
                "pointer-events-none ml-1 select-none",
                counterClass
              )}>
              {charCount}/{AI_INPUT_MAX}
            </span>
          )}

          {}
          <div className="ml-auto flex items-center gap-1">
            {
}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    onClick={() => void handlePickImages()}
                    disabled={!canAttachImages || isPickingImages}
                    size="icon"
                    variant="ghost"
                    aria-label="添加图片"
                    title="添加图片"
                    className={cn(
                      "h-7 w-7 rounded-md active:scale-95",
                      "hover:bg-muted"
                    )}>
                    {isPickingImages ? (
                      <Loader2 className="!h-3 !w-3 animate-spin" />
                    ) : (
                      <ImagePlus className="!h-3 !w-3" />
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                <p className="text-xs">添加图片（也可直接粘贴或拖入）</p>
              </TooltipContent>
            </Tooltip>

            {
}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
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

            {
}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
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
                  <p className="text-xs">输入内容或添加图片后发送</p>
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
