import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import "./index.css";
import Layout from "./components/core/layout";
import { Toaster } from "./components/ui/toaster";
import { FloatingAiAssistant } from "./components/core/FloatingAiAssistant";
import { useScrollIndicator } from "./hooks/useScrollIndicator";
import { pushExternalAdd } from "./components/shortcut/externalAdd";
import { cn } from "./lib/utils";

import HomePage from "./pages/HomePage";
import NotesPage from "./pages/NotesPage";
import SettingsPage from "./pages/SettingsPage";
import TodoPage from "./pages/TodoPage";
import BrowserPage from "./pages/BrowserPage";
import SkillsPage from "./pages/SkillsPage";

const LeetcodeCollection = lazy(() => import("./components/Leetcode/Collection"));

/**
 * 全部页面路由
 *
 * 这里显式列出而不是用 <Routes>：keep-alive 需要"访问过就保留实例"，
 * 而 Routes 天生是渲染当前匹配项、切走即卸载。
 */
const PAGES = [
  { path: "/", node: <HomePage /> },
  { path: "/notes", node: <NotesPage /> },
  { path: "/settings", node: <SettingsPage /> },
  { path: "/todos", node: <TodoPage /> },
  { path: "/leetcode", node: <LeetcodeCollection /> },
  { path: "/browser", node: <BrowserPage /> },
  { path: "/skills", node: <SkillsPage /> },
];

function App() {
  // 滚动时显示滚动条，闲置 800ms 后隐藏
  useScrollIndicator(800);

  const { pathname } = useLocation();
  const navigate = useNavigate();

  /**
   * 系统右键菜单「添加到 QNote 快捷方式」的接收端
   *
   * 必须挂在 App 层而不是 HomePage：页面是 keep-alive 的，**没访问过的主页
   * 根本没有挂载**，监听器不存在，主进程那条消息就被静默丢弃 ——
   * 用户表现为"在资源管理器里点了右键菜单，QNote 里什么都没发生"。
   *
   * 这里统一负责跳转：无论当前停在哪个页面，先回主页，HomePage 挂载后
   * 会从 externalAdd 的 pending 里把这条请求取走并弹确认框。
   */
  useEffect(() => {
    return window.electron.onExternalAddShortcut((target) => {
      pushExternalAdd(target);
      // react-router v7 里 navigate 的返回类型是 void | Promise<void>，
      // 这里不需要它的结果，显式 void 忽略，运行时行为不变
      if (pathname !== "/") void navigate("/");
    });
  }, [pathname, navigate]);

  /**
   * 访问过的页面保持挂载，切走只是隐藏
   *
   * 之前用 <Routes> 时，切页会卸载旧页面 —— 组件内 state 全部清零、
   * 挂载时的数据拉取重跑一遍（HomePage 会重新 loadHistory()），
   * 滚动位置、已打开的弹窗、输入到一半的搜索词一并丢失。
   *
   * 只渲染"访问过"的页面而不是全部预挂载：否则启动时就会把所有页面的
   * useEffect 跑一遍（Leetcode / Notes 等都会拉数据）。
   */
  const [visited, setVisited] = useState<string[]>([pathname]);
  useEffect(() => {
    setVisited((prev) => (prev.includes(pathname) ? prev : [...prev, pathname]));
  }, [pathname]);

  return (
    <Layout>
      <Suspense
        fallback={
          <div className="flex-1 flex flex-col items-center justify-center animate-fade-in">
            <div className="relative mb-4">
              {/* Outer glow — matches empty state design language */}
              <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl scale-125" />
              <div className="relative w-12 h-12 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground/70 font-medium animate-fade-in-stagger">
              加载中...
            </p>
          </div>
        }>
        {PAGES.filter((page) => visited.includes(page.path)).map((page) => (
          <div
            key={page.path}
            className={cn("h-full", page.path === pathname ? "block" : "hidden")}
            aria-hidden={page.path !== pathname}
            /* display:none 的页面收不到焦点和按键，
               window 级监听器由页面自己用 useRouteActive 守卫 */
          >
            {page.node}
          </div>
        ))}
      </Suspense>
      {/* 全局 AI 助手浮框 — 任意路由都可访问，独立于 HomePage */}
      <FloatingAiAssistant />
      <Toaster />
    </Layout>
  );
}

export default App;
