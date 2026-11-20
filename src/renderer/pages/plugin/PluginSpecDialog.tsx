import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PluginSpecDialogProps {
  open: boolean;
  onClose: () => void;
}

const EXAMPLE = `{
  "id": "local.tomato-clock",
  "name": "番茄钟",
  "version": "1.0.0",
  "publisher": "local",
  "description": "一个网页版番茄钟",
  "license": "MIT",
  "engines": { "qnote": "^2.0.0" },
  "runtime": {
    "command": "node server.js",
    "args": ["--port", "3000"],
    "cwd": ".",
    "env": { "NODE_ENV": "production" },
    "preview": { "type": "port", "port": 3000 }
  },
  "capabilities": {
    "process": { "spawn": true },
    "network": ["localhost"],
    "filesystem": { "read": ["."], "write": [] },
    "qnote": {
      "notes": "none",
      "todos": "none",
      "clipboard": "none",
      "ai": "none"
    }
  },
  "contributes": {
    "commands": [
      { "command": "tomato.start", "title": "开始番茄钟", "category": "番茄钟" }
    ],
    "settings": [
      { "key": "tomato.duration", "type": "number", "default": 25, "title": "番茄时长（分钟）" }
    ],
    "sidebar": [{ "id": "tomato", "title": "番茄钟", "icon": "timer" }]
  }
}`;

export function PluginSpecDialog({ open, onClose }: PluginSpecDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>插件清单规范</DialogTitle>
          <DialogDescription>
            一个文件夹要成为「可管理的插件」，根目录下必须有一份 plugin.json。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="space-y-2">
            <p className="font-medium">必填项</p>
            <ul className="list-disc pl-5 space-y-1 text-[13px] text-muted-foreground leading-relaxed">
              <li>
                <code className="font-mono text-xs">id</code> ——
                业务标识，publisher.name 格式，只能用字母、数字、点和短横线。
              </li>
              <li>
                <code className="font-mono text-xs">name</code> ——
                界面上显示的名字。
              </li>
              <li>
                <code className="font-mono text-xs">version</code> ——
                MAJOR.MINOR.PATCH 格式的语义化版本。
              </li>
              <li>
                <code className="font-mono text-xs">publisher</code> ——
                发布者标识。
              </li>
              <li>
                <code className="font-mono text-xs">engines.qnote</code> ——
                宿主版本约束，例如 <code className="font-mono text-xs">^2.0.0</code>。
                不满足当前 QNote 版本时插件能装但不能启动。
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="font-medium">runtime 段</p>
            <ul className="list-disc pl-5 space-y-1 text-[13px] text-muted-foreground leading-relaxed">
              <li>
                <code className="font-mono text-xs">command</code> 与{" "}
                <code className="font-mono text-xs">preview</code> 至少填一个：
                前者是常驻启动命令，后者是要在 QNote 里预览的页面。
              </li>
              <li>
                <code className="font-mono text-xs">command</code> 以常驻进程运行，
                点「停止」才结束；输出实时显示在运行控制台。
              </li>
              <li>
                <code className="font-mono text-xs">preview</code> 三选一：
                <code className="font-mono text-xs">{"{ \"type\": \"port\", \"port\": 7799 }"}</code>{" "}
                <code className="font-mono text-xs">{"{ \"type\": \"url\", \"url\": \"http://...\" }"}</code>{" "}
                <code className="font-mono text-xs">{"{ \"type\": \"path\", \"path\": \"dist/index.html\" }"}</code>。
                相对路径按插件根目录解析。
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="font-medium">capabilities 段</p>
            <ul className="list-disc pl-5 space-y-1 text-[13px] text-muted-foreground leading-relaxed">
              <li>
                <code className="font-mono text-xs">process.spawn</code> ——
                没声明这一项的插件主进程拒绝启动，填了启动命令就必须带上它。
              </li>
              <li>
                <code className="font-mono text-xs">qnote</code> ——
                笔记、待办可选 none / read / write，剪贴板与 AI 只能 none / read。
              </li>
              <li>
                <code className="font-mono text-xs">network</code> 与{" "}
                <code className="font-mono text-xs">filesystem</code> ——
                声明能访问的域名与目录。
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="font-medium">contributes 段</p>
            <ul className="list-disc pl-5 space-y-1 text-[13px] text-muted-foreground leading-relaxed">
              <li>
                <code className="font-mono text-xs">commands</code> ——
                往命令面板里加命令，每项要写 command 与 title。
              </li>
              <li>
                <code className="font-mono text-xs">settings</code> ——
                往设置页里加配置项，type 只能是 string / number / boolean。
              </li>
              <li>
                <code className="font-mono text-xs">sidebar</code> ——
                往侧栏里加入口，每项要写 id 与 title。
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
