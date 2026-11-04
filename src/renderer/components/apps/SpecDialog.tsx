import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 清单规范说明
 *
 * 规范本身写在 docs/APP-MANAGEMENT.md，这里放的是**能照着抄**的最小示例 ——
 * 用户点开这个弹窗，多半正准备写第一份 qnote.json。
 */
interface SpecDialogProps {
  open: boolean;
  onClose: () => void;
}

const EXAMPLE = `{
  "name": "番茄钟",
  "description": "一个网页版番茄钟",
  "command": "node server.js",
  "args": ["--port", "3000"],
  "cwd": ".",
  "env": { "NODE_ENV": "production" },
  "preview": "dist/index.html"
}`;

export function SpecDialog({ open, onClose }: SpecDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>项目清单规范</DialogTitle>
          <DialogDescription>
            一个文件夹要成为「可管理的项目」，根目录下必须有一份 qnote.json。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="space-y-2">
            <p className="font-medium">规则</p>
            <ul className="list-disc pl-5 space-y-1 text-[13px] text-muted-foreground leading-relaxed">
              <li>
                在「应用」页点<b>导入文件夹</b>，选中的那个文件夹<b>本身就是项目</b>，
                不需要先指定一个根目录。
              </li>
              <li>
                项目之间没有父子关系 —— 同一个应用里可以同时管理
                D 盘、外接盘、任意路径下的项目。
              </li>
              <li>
                项目根目录下必须有 <code className="font-mono text-xs">qnote.json</code>，
                没有清单的项目不可启动、不可预览，界面上标为「未配置」。
              </li>
              <li>
                <code className="font-mono text-xs">command</code> 与{" "}
                <code className="font-mono text-xs">preview</code> 至少填一个：
                前者是常驻启动命令，后者是要在应用里预览的页面。
              </li>
              <li>
                <code className="font-mono text-xs">command</code> 以常驻进程运行，
                点「停止」才结束；输出实时显示在运行控制台。
              </li>
              <li>
                <code className="font-mono text-xs">preview</code> 写相对路径时按项目根目录解析，
                写成 <code className="font-mono text-xs">http://...</code>{" "}
                则直接加载那个地址。
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="font-medium">示例</p>
            <pre className="rounded-md border border-border/60 bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed overflow-x-auto">
              {EXAMPLE}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
