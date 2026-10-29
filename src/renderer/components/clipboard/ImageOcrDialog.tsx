import { useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import {
  Bookmark,
  Check,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";

interface ImageOcrDialogProps {
  open: boolean;
  dialogImage: string | null;
  ocrResult: string;
  ocrType: "standard" | "accurate" | "webimage";
  ocrLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onOcrTypeChange: (type: "standard" | "accurate" | "webimage") => void;
  onOcrExtract: () => void;
  onCopyResult: () => void;
  onAddToVector: () => void;
}

export function ImageOcrDialog({
  open,
  dialogImage,
  ocrResult,
  ocrType,
  ocrLoading,
  onOpenChange,
  onOcrTypeChange,
  onOcrExtract,
  onCopyResult,
  onAddToVector,
}: ImageOcrDialogProps) {
  // Track action feedback states — brief success flash after click
  const [copiedOcr, setCopiedOcr] = useState(false);
  const [indexedOcr, setIndexedOcr] = useState(false);

  const handleCopy = () => {
    onCopyResult();
    setCopiedOcr(true);
    setTimeout(() => setCopiedOcr(false), 2500);
  };

  const handleAddToVector = () => {
    onAddToVector();
    setIndexedOcr(true);
    setTimeout(() => setIndexedOcr(false), 2500);
  };

  // Character count derived from ocrResult — shown in result header
  const charCount = ocrResult.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 高度从 70vh 提到 80vh：这个弹框的主体就是那张待识别的图，
          框越高留给图片的空间越大，缩放查看的余地也越多。 */}
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-0 border-b px-5 py-3.5">
          {/* 图标块按 DESIGN.md 的 Icon Block 规格：rounded-lg + bg-primary/10
              + ring，而不是圆形底座。原来的 rounded-full 32×32 是全项目独一份的画法。 */}
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
              <ImageIcon className="h-4 w-4 text-primary" />
            </span>
            图片预览与 OCR 识别
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col">
            {/*
             * 图片预览区
             *
             * 原 bug：max-h-full 加在 <img> 上，而它的父层是高度 auto 的
             * relative/group 包裹层 —— 百分比 max-height 对着 auto 高度直接失效，
             * 图片按原始尺寸渲染并溢出；外层又是 items-center 居中，超出部分上下
             * 对称被裁。实测（Chromium，容器 68px / 图片 600x2400）：
             *   渲染 602x2402，顶端超出且【滚不回去】—— 就是"滚动后发现有缺失"。
             *
             * 现在：外层滚动容器补 min-h-0（flex 子项不给就不肯收缩），内层包裹层
             * min-h-full 撑满可视区，给百分比一个可依附的高度。实测结果：
             *   · 方图 900x900  → 渲染 389x389，完整缩放进框，不滚动
             *   · 长图 600x2400 → 渲染 602x2402 原始尺寸 + 框内滚动，
             *                      但顶端【已可达】，内容一处不缺
             *
             * 刻意不改成 h-full + 无条件缩到框内：那样 600x2400 会被压成 97x389，
             * 一个字都读不了。OCR 预览宁可滚动也不该把图缩成条。
             */}
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {dialogImage ? (
                <div className="flex min-h-full items-center justify-center">
                  <img
                    src={dialogImage}
                    alt="待识别的图片预览"
                    className="max-h-full max-w-full rounded-lg border border-border object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  暂无图片
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border p-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-foreground/80">
                    识别模式
                  </label>
                  {/* 三个选项的模式选择器保留原生 <select>：系统级下拉在桌面工具里
                      比自绘 listbox 更顺手，键盘与高亮行为也由系统保证。
                      样式对齐 DESIGN.md §Input（36px 高、bg-background、
                      border-border/70、ring-2 ring-primary/30），去掉 ring-offset
                      —— 偏移会在彩色 focus 环外留一圈白缝。 */}
                  <select
                    className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                    value={ocrType}
                    onChange={(e) =>
                      onOcrTypeChange(e.target.value as "standard" | "accurate" | "webimage")
                    }
                    disabled={ocrLoading}>
                    <option value="standard">通用文字识别（标准）</option>
                    <option value="accurate">通用文字识别（高精度）</option>
                    <option value="webimage">网络图片文字识别</option>
                  </select>
                </div>
                {/* 直接用 Button 默认 primary 样式。原先额外挂的
                    hover:shadow-lg + hover:-translate-y-px 是装饰：shadow-lg 按
                    DESIGN.md 只留给浮框与模态条，按钮静止时不该有投影。 */}
                <Button onClick={onOcrExtract} disabled={ocrLoading}>
                  {ocrLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      识别中…
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      开始识别
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex w-80 shrink-0 flex-col border-l border-border">
            <div className="shrink-0 border-b border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
                    <FileText className="h-3 w-3 text-primary" />
                  </span>
                  识别结果
                </h4>
                {ocrResult && (
                  /* Status Badge 规格是 rounded-md(6px)，不是 pill */
                  <span className="rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground/70">
                    {charCount.toLocaleString()} 字
                  </span>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {ocrResult ? (
                <div className="rounded-lg border border-border bg-muted/50 p-4">
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                    {ocrResult}
                  </div>
                </div>
              ) : (
                /* 空状态：与剪贴板会话列表保持同一套画法 —— 图标块 + 主副文案。
                   原来的 blur-2xl 光晕 + icon-glow-ring 径向渐变辉光 + 无限浮动
                   属于 DESIGN.md 禁掉的"发光当装饰"，三个动效叠在一起还会让
                   这个本来就该安静的弹框一直动。 */
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <FileText className="h-6 w-6 text-primary/70" />
                  </span>
                  <p className="mb-1.5 text-sm font-medium text-foreground/80">
                    点击「开始识别」
                  </p>
                  <p className="max-w-[180px] text-xs leading-relaxed text-muted-foreground/70">
                    开始识别图片中的文字内容
                  </p>
                </div>
              )}
            </div>

            {ocrResult && (
              <div className="shrink-0 border-t border-border p-4">
                <div className="flex gap-2">
                  {/* 两个按钮的成功态统一为「原图标 → Check」，
                      之前一个用 Check、一个用 Pin，同一屏里两套成功语言。 */}
                  <Button
                    onClick={handleCopy}
                    size="sm"
                    className={cn("flex-1", copiedOcr ? "copy-success-btn" : undefined)}
                    aria-label={copiedOcr ? "已复制" : "复制识别结果"}>
                    {copiedOcr ? (
                      <>
                        <Check className="h-4 w-4" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        复制结果
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleAddToVector}
                    size="sm"
                    variant={indexedOcr ? undefined : "outline"}
                    className={cn(
                      "flex-1",
                      indexedOcr ? "copy-success-btn" : "border-primary/25 text-primary hover:bg-primary/5 hover:text-primary"
                    )}
                    aria-label={indexedOcr ? "已添加到索引" : "添加索引"}>
                    {indexedOcr ? (
                      <>
                        <Check className="h-4 w-4" />
                        已添加
                      </>
                    ) : (
                      <>
                        <Bookmark className="h-4 w-4" />
                        添加索引
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}