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
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AI_IMAGE_MAX_COUNT, aiImageDataUrl, type AiImageAttachment } from "@shared/aiImages";
import { filesToAttachments, normalizeImageAttachment } from "@/utils/imageAttachments";

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
  /** 待发送的图片附件 */
  images?: AiImageAttachment[];
  /** 追加图片附件 */
  onAddImages?: (images: AiImageAttachment[]) => void;
  /** 移除指定序号的图片附件 */
  onRemoveImage?: (index: number) => void;
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
 *   · 整框高度 = 正文区（min 84px）+ 操作行（按钮 28px + 下边距 8px）≈ 120px，
 *     随正文变长向下长
 *   · 正文占满整个框的宽度，**右侧不留 padding** —— 按钮在下方独立的一排里，
 *     和正文不重叠，不需要让位
 *   · 图片 / 麦克风 / 发送三个 h-7 w-7 按钮同处操作行右端，
 *     计数器在操作行左端，快写满时才出现
 *
 * 图片附件有三个入口：粘贴、拖拽、点按钮选文件。
 * 三个入口都只做「拿到图 → 缩图 → 交给上层」，状态在 useAiAssistant 里。
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
  images = [],
  onAddImages,
  onRemoveImage,
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
    : disabled || (!value.trim() && images.length === 0) || isAtLimit;

  const handleClick = () => {
    if (isStopMode) {
      onStop?.();
      return;
    }
    onSubmit();
  };

  // ============================================================
  // 图片附件
  // ============================================================

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isPickingImages, setIsPickingImages] = useState(false);
  // 拖拽进入时不能让浏览器直接打开那张图
  const dragDepthRef = useRef(0);

  const canAttachImages = Boolean(onAddImages) && !disabled;

  /** 这次拖拽带的是文件吗（而不是选中的文本） */
  const hasDraggedFiles = (event: DragEvent<HTMLDivElement>): boolean => {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes("Files");
  };

  /**
   * 收下这些图：限量 → 交给上层
   *
   * 限量放在这里而不是上层：粘贴、拖拽、选文件三个入口都要过这一道，
   * 少一个入口就少一处「用户加了 6 张，第 6 张被静默丢掉」的坑。
   */
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

  /** 文件 → 缩图 → 收下 */
  const attachFiles = async (files: File[]) => {
    if (!canAttachImages || files.length === 0) return;
    const attachments = await filesToAttachments(files);
    if (attachments.length === 0) {
      toast({ title: "图片读取失败", description: "这个文件不是可用的图片", variant: "destructive" });
      return;
    }
    addAttachments(attachments);
  };

  /**
   * 粘贴图片
   *
   * 剪贴板里有图时必须 preventDefault —— 否则浏览器会把图片当成
   * 「文件名」之类的文本塞进输入框，用户看到的是一堆乱码。
   *
   * 同时带文字和图片的情况很少见（少数应用会），但真出现了就把文字也留下，
   * 总比把用户的文字弄丢强。
   */
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

  /** 拖拽进入 */
  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachImages) return;
    // 只认「拖着文件」的拖拽：在输入框里选中文本拖动也会冒泡出 dragenter，
    // 不区分的话会把文本拖拽也当成「要加图」
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingOver(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canAttachImages) return;
    if (!hasDraggedFiles(event)) return;
    // 不 preventDefault 的话 drop 事件根本不会触发
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

  /** 打开系统选图框 */
  const handlePickImages = async () => {
    if (!canAttachImages || isPickingImages) return;
    setIsPickingImages(true);
    try {
      const picked = await window.electron.pickAiImages();
      if (!picked || picked.length === 0) return;
      // 主进程给的是原始字节，这里缩到能发的大小
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
          // 拖拽悬停时给一圈虚线，提示「松手就能加图」
          isDraggingOver && "border-primary/60 ring-2 ring-primary/25 bg-primary/[0.03]"
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
        {images.length > 0 && (
          /* 待发送的图片缩略图 —— 贴在输入框上方，删除按钮在右上角 */
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
            // 最小高度 84px —— 空内容时也保持一个大框（用户确认的预期）。
            //
            // 原来是 min-h-0 + max-h-120px，空的时候塌成单行 36px。
            // 单行框的问题不只是"矮"：它把"这是一个可以写长句子的地方"
            // 这个信号藏掉了，而 AI 输入框恰恰最常写长句。
            //
            // min-height 在 CSS 里**压过** height，所以 useAutoGrowTextarea
            // 那句 el.style.height = scrollHeight 依然照常执行：
            // 空内容写 36px → 被 min 抬回 84px；
            // 内容多了写更大的值 → 从 84px 往上长。
            // 两边不冲突，不需要去改那个 hook。
            //
            // 84px 而不是 120px：按钮那一排（28px + 8px 下边距）现在在正常流里，
            // 占掉了 36px。84 + 36 = 120，与改版前整框的高度一致 ——
            // 挪的是按钮的定位方式，不是整框的尺寸。
            "max-h-[200px] min-h-[84px] w-full resize-none border-0 bg-transparent",
            //
            // **右边不留 padding**。
            //
            // 之前这里是 pr-28（112px），本意是给右下角那排按钮留位，
            // 免得文字压到按钮底下。但那排按钮是 absolute 挂在容器底边的，
            // 和正文并不在同一行 —— pr-28 会作用到**每一行**文字上，
            // 于是除最后一行外，每行右边都空出 112px 的一条死区，
            // 短句看起来就像"右边缺了一块"。
            //
            // 按钮改成正常流里的操作行之后，正文和按钮不再重叠，
            // 预留就完全没有必要了：文字宽度用满整个框。
            "px-3 py-2 text-sm leading-5",
            "shadow-none outline-none focus-visible:ring-0 disabled:cursor-not-allowed"
          )}
        />

        {/*
         * 操作行 —— 图片 / 麦克风 / 发送，外加快写满时才冒出来的计数器。
         *
         * 这一排在**正常流**里（不是 absolute），所以：
         *   · 正文可以占满整个框的宽度，不用给按钮让位；
         *   · 文字再长也不会压到按钮底下，不需要额外预留 padding；
         *   · 计数器放进这一排后，正文也不用为了它加 pl-20。
         *
         * 行高由按钮的 28px 决定，计数器是 10px 的小胶囊，
         * 出现与消失都不会改变这一行的高度，正文因此不会跳动。
         */}
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

          {/* ml-auto：按钮组永远贴右边，计数器出现时也不会把它们挤走 */}
          <div className="ml-auto flex items-center gap-1">
            {/*
             * 添加图片按钮。
             *
             * 放在麦克风左边 —— 两个都是「往输入框里补东西」的动作，
             * 挨在一起比分散在两端好找。选中态没有（图片是加进来就可见，
             * 状态在上面的缩略图条里），所以不需要额外的视觉状态。
             */}
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
             * span 保留尺寸、继续接收 hover。
             */}
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
