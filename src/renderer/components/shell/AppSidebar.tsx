import { Home, Settings, BookOpen, PenTool, PanelLeftClose, PanelLeftOpen, ListChecks, Globe, Sparkles, Boxes, Puzzle } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "../ui/sidebar";
import { useSidebarTabs, type SidebarTabsConfig } from "@/hooks/shell/useSidebarTabs";
import { usePluginRegistry } from "@/hooks/plugin/usePluginRegistry";

type TabKey = keyof SidebarTabsConfig;

interface SidebarItem {
  title: string;
  url: string;
  icon: typeof Home;
  tabKey?: TabKey | "always";
}

const items: SidebarItem[] = [
  {
    title: "主页",
    url: "/",
    icon: Home,
    tabKey: "always",
  },
  {
    title: "笔记",
    url: "/notes",
    icon: BookOpen,
    tabKey: "notes",
  },
  {
    title: "Todo",
    url: "/todos",
    icon: ListChecks,
    tabKey: "todos",
  },
  {
    title: "力扣分类",
    url: "/leetcode",
    icon: PenTool,
    tabKey: "leetcode",
  },
  {
    title: "浏览器",
    url: "/browser",
    icon: Globe,
    tabKey: "browser",
  },
  {
    title: "插件",
    url: "/plugins",
    icon: Boxes,
    tabKey: "plugins",
  },
  {
    title: "技能 / MCP",
    url: "/skills",
    icon: Sparkles,
    tabKey: "always",
  },
  {
    title: "设置",
    url: "/settings",
    icon: Settings,
    tabKey: "settings",
  },
];

interface PluginSidebarEntry {
  key: string;
  title: string;
  pluginId: string;
}

export function AppSidebar() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [tabsConfig] = useSidebarTabs();
  const { plugins } = usePluginRegistry();

  const visibleItems = items.filter((item) => {
    if (item.tabKey === "always" || !item.tabKey) return true;
    return tabsConfig[item.tabKey];
  });

  const selectedPlugin = searchParams.get("plugin");
  const pluginEntries: PluginSidebarEntry[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const entry of plugin.contributes?.sidebar ?? []) {
      pluginEntries.push({
        key: `${plugin.id}:${entry.id}`,
        title: entry.title,
        pluginId: plugin.id,
      });
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="pt-10">
        <SidebarGroup>
          <SidebarGroupContent>
            {}
            <nav aria-label="主导航">
              <SidebarMenu>
                {visibleItems.map((item) => (
                  <SidebarMenuItem key={item.title} data-active={location.pathname === item.url}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={location.pathname === item.url}>
                      {
}
                      <Link
                        to={item.url}
                        aria-current={location.pathname === item.url ? "page" : undefined}
                        data-active={location.pathname === item.url}
                        className={`flex items-center gap-3 px-2 py-1.5 text-sm font-medium rounded-md sidebar-menu-btn ${
                          location.pathname === item.url
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`}>
                        <item.icon className="h-4 w-4" />
                        {
}
                        <span className="truncate whitespace-nowrap">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {pluginEntries.map((entry) => (
                  <SidebarMenuItem key={entry.key}>
                    <SidebarMenuButton
                      asChild
                      tooltip={entry.title}
                      isActive={
                        location.pathname === "/plugins" &&
                        selectedPlugin === entry.pluginId
                      }>
                      <Link
                        to={`/plugins?plugin=${encodeURIComponent(entry.pluginId)}`}
                        aria-current={
                          location.pathname === "/plugins" &&
                          selectedPlugin === entry.pluginId
                            ? "page"
                            : undefined
                        }
                        className="flex items-center gap-3 px-2 py-1.5 text-sm font-medium rounded-md sidebar-menu-btn hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                        <Puzzle className="h-4 w-4" />
                        <span className="truncate whitespace-nowrap">{entry.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {
}
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
              aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}>
              <button
                type="button"
                onClick={toggleSidebar}
                className="flex items-center gap-3 px-2 text-sm rounded-md sidebar-menu-btn hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                {}
                {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                <span className="truncate whitespace-nowrap">
                  {isCollapsed ? "展开侧边栏" : "收起侧边栏"}
                </span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}