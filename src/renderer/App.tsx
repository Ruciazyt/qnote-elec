import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import "./index.css";
import Layout from "./components/shell/layout";
import { Toaster } from "./components/ui/toaster";
import { FloatingAiAssistant } from "./components/ai/FloatingAiAssistant";
import { useScrollIndicator } from "./hooks/shell/useScrollIndicator";
import { pushExternalAdd } from "./pages/home/shortcut/externalAdd";
import { pushIslandOpenNote } from "./pages/island/islandBridge";
import { cn } from "./lib/utils";

import HomePage from "./pages/home/HomePage";
import NotesPage from "./pages/notes/NotesPage";
import SettingsPage from "./pages/settings/SettingsPage";
import TodoPage from "./pages/todo/TodoPage";
import BrowserPage from "./pages/browser/BrowserPage";
import SkillsPage from "./pages/skills/SkillsPage";
import AppsPage from "./pages/apps/AppsPage";

const LeetcodeCollection = lazy(() => import("./pages/leetcode/LeetcodePage"));

const PAGES = [
  { path: "/", node: <HomePage /> },
  { path: "/notes", node: <NotesPage /> },
  { path: "/settings", node: <SettingsPage /> },
  { path: "/todos", node: <TodoPage /> },
  { path: "/leetcode", node: <LeetcodeCollection /> },
  { path: "/browser", node: <BrowserPage /> },
  { path: "/apps", node: <AppsPage /> },
  { path: "/skills", node: <SkillsPage /> },
];

function App() {
  useScrollIndicator(800);

  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    return window.electron.onExternalAddShortcut((target) => {
      pushExternalAdd(target);
      if (pathname !== "/") void navigate("/");
    });
  }, [pathname, navigate]);

  useEffect(() => {
    return window.electron.onIslandNavigate(({ route, relPath }) => {
      if (relPath) pushIslandOpenNote(relPath);
      if (route && route !== pathname) void navigate(route);
    });
  }, [pathname, navigate]);

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
              {}
              <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl scale-125" />
              <div className="relative w-12 h-12 rounded-2xl bg-primary/10 border border-primary/15 flex items-center justify-center">
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
          >
            {page.node}
          </div>
        ))}
      </Suspense>
      {}
      <FloatingAiAssistant />
      <Toaster />
    </Layout>
  );
}

export default App;
