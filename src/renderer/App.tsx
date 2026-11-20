import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import "./index.css";
import Layout from "./components/shell/layout";
import { Toaster } from "./components/ui/toaster";
import { CommandPalette } from "./components/panel/CommandPalette";
import { FloatingAiAssistant } from "./pages/ai/FloatingAiAssistant";
import { useScrollIndicator } from "./hooks/shell/useScrollIndicator";
import { usePluginCommands } from "./hooks/plugin/usePluginCommands";
import { usePluginRegistry } from "./hooks/plugin/usePluginRegistry";
import { toast } from "./hooks/ui/use-toast";
import { publishRoutePath } from "./hooks/system/routeStore";
import { pushExternalAdd } from "./pages/home/shortcut/externalAdd";
import { pushIslandOpenNote } from "./pages/island/islandBridge";
import { cn } from "./lib/utils";

import HomePage from "./pages/home/HomePage";
import NotesPage from "./pages/notes/NotesPage";
import SettingsPage from "./pages/settings/SettingsPage";
import TodoPage from "./pages/todo/TodoPage";
import BrowserPage from "./pages/browser/BrowserPage";
import SkillsPage from "./pages/skills/SkillsPage";
import PluginsPage from "./pages/plugin/PluginsPage";

const LeetcodeCollection = lazy(() => import("./pages/leetcode/LeetcodePage"));

const FLOATING_AI_ASSISTANT = <FloatingAiAssistant />;
const TOASTER = <Toaster />;

const PAGES = [
  { path: "/", node: <HomePage /> },
  { path: "/notes", node: <NotesPage /> },
  { path: "/settings", node: <SettingsPage /> },
  { path: "/todos", node: <TodoPage /> },
  { path: "/leetcode", node: <LeetcodeCollection /> },
  { path: "/browser", node: <BrowserPage /> },
  { path: "/plugins", node: <PluginsPage /> },
  { path: "/skills", node: <SkillsPage /> },
];

function App() {
  useScrollIndicator(800);

  const { pathname } = useLocation();
  const navigate = useNavigate();

  useLayoutEffect(() => {
    publishRoutePath(pathname);
  }, [pathname]);

  useEffect(() => {
    return window.electron.onExternalAddShortcut((target) => {
      pushExternalAdd(target);
      if (pathname !== "/") void navigate("/");
    });
  }, [pathname, navigate]);

  useEffect(() => {
    return window.electron.onTodoReminder((payload) => {
      if (pathname !== "/todos") void navigate("/todos");
      toast({
        title: `提醒：${payload.title}`,
        description: payload.notes?.trim() || undefined,
      });
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

  const [paletteOpen, setPaletteOpen] = useState(false);
  const { commands, run: runCommand } = usePluginCommands();
  const { pluginNames } = usePluginRegistry();
  const pluginNamesRef = useRef(pluginNames);

  useEffect(() => {
    pluginNamesRef.current = pluginNames;
  }, [pluginNames]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "p") return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (!event.shiftKey) return;
      event.preventDefault();
      setPaletteOpen((prev) => !prev);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return window.electron.onPluginNotify((payload) => {
      toast({
        title: pluginNamesRef.current[payload.pluginId] ?? "插件",
        description: payload.message,
        variant: payload.level === "error" ? "destructive" : "default",
      });
    });
  }, []);

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
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        pluginNames={pluginNames}
        onRun={(command) => void runCommand(command)}
      />
      {FLOATING_AI_ASSISTANT}
      {TOASTER}
    </Layout>
  );
}

export default App;
