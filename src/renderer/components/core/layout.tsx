import { SidebarProvider } from "../ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import TitleBar from "./TitleBar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar />
        {/* min-w-0 必须有：main 是 row flex item，默认 min-width:auto 会取 automatic
            minimum size（= min-content）。里面任何一行不换行的长文本 —— 代码块、URL、
            单行日志 —— 都会把 min-content 顶到几千像素，进而把整个窗口横向撑开，
            实测剪贴板一行长代码能让 1070px 的窗口涨到 5730px。加上 min-w-0 后，
            main 可以缩到内容以下，超长内容交由内部的 overflow 容器自己处理。 */}
        <main className="flex-1 flex flex-col min-h-screen min-w-0">
          <TitleBar />
          {/* 内容面板：与外框（标题栏 + 侧栏）异色 + 四角圆角 + 8px 边距，见 index.css .content-panel
              mt-12 = 40px 标题栏高度 + 8px 上边距（顶边距由 Tailwind 提供，
              不能写进 .content-panel，否则会覆盖掉这里避开固定标题栏的位移） */}
          <div className="flex-1 overflow-auto mt-12 page-transition content-panel">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
