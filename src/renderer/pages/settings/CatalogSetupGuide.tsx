import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CatalogSetupGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CatalogSetupGuide({
  open,
  onOpenChange,
}: CatalogSetupGuideProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl modal-card">
        <DialogHeader>
          <DialogTitle>公共目录说明</DialogTitle>
          <DialogDescription>
            公共目录是一份所有 QNote 用户共享的 APP 目录。正式版已经内置了官方公共目录的连接信息，
            装好就能用，不用填任何东西。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[13px] leading-relaxed text-foreground/90">
          <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2.5">
            <p className="mb-1 font-medium">默认怎么用</p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground/90">
              <li>什么都不用填。上面保持「公共目录」，所有人看到同一份目录。</li>
              <li>
                只有<strong className="font-medium text-foreground/85">发布出去的 APP 目录</strong>
                在云上；笔记、剪贴板、Todo、AI 对话这些你自己的数据永远在本机。
              </li>
              <li>只想自己用、不参与共享目录，在上面选「仅本地」就行。</li>
            </ul>
          </div>

        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button type="button" className="h-9 text-xs">
              知道了
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}