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
import { ExternalLink } from "lucide-react";

const CONSOLE_URL = "https://tidbcloud.com/project/data-service";

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

          <div className="rounded-md border border-border/70 px-3 py-2.5">
            <p className="mb-1 font-medium">想用自己的目录（一般用不着）</p>
            <ol className="space-y-1 pl-4 list-decimal text-muted-foreground/90">
              <li>在 TiDB Cloud 建一个 Data App，关联你的 Starter 实例</li>
              <li>
                点左栏 Data App 的名字，右侧切到 <strong className="font-medium text-foreground/85">Settings</strong> 标签
              </li>
              <li>
                找到 <strong className="font-medium text-foreground/85">Authentication</strong> → Create API Key
                （角色选 ReadAndWrite，发布目录要写权限；限流默认 100 就够）
              </li>
              <li>
                <strong className="font-medium text-foreground/85">Private Key 只显示一次</strong>，当场复制走
              </li>
              <li>把下面四个框换成你自己的，测试连接 → 保存</li>
            </ol>
            <ul className="mt-2 space-y-1 pl-4 list-disc text-muted-foreground/75">
              <li>
                站点地址要填<strong className="font-medium">区域站点</strong>（形如{" "}
                <code className="text-[11px]">https://ap-northeast-1.data.tidbcloud.com</code>
                ）。别填全局域名 <code className="text-[11px]">data.tidbcloud.com</code> —— 它会跳转，
                跳转后鉴权头会丢，必然 401。
              </li>
              <li>Private Key 只存在本机，不上传；想作废随时在控制台 Authentication → Expire All。</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            className="h-9 text-xs"
            onClick={() => {
              void window.electron.openExternal(CONSOLE_URL);
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            打开 TiDB Cloud 控制台
          </Button>
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