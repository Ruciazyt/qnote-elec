import { useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
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

  const charCount = ocrResult.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {
}
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-0 border-b px-5 py-3.5">
          {
}
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
              <ImageIcon className="h-4 w-4 text-primary" />
            </span>
            {
}
            <span>图片预览与 OCR 识别</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col">
            {
}
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
                  <label
                    htmlFor="ocr-type-select"
                    className="mb-1.5 block text-sm font-medium text-foreground/80">
                    识别模式
                  </label>
                  {
}
                  <select
                    id="ocr-type-select"
                    className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
                {
}
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
                  <span>识别结果</span>
                </h4>
                {ocrResult && (
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
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <FileText className="h-6 w-6 text-primary" />
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
                  {
}
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
                      indexedOcr ? "copy-success-btn" : "border-primary/25 text-primary-strong hover:bg-primary/5 hover:text-primary-strong"
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