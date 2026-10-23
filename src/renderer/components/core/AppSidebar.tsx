import { Home, Settings, BookOpen, PenTool, PanelLeftClose, PanelLeftOpen, ListChecks, Globe, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router";
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
import { useSidebarTabs, type SidebarTabsConfig } from "@/hooks/useSidebarTabs";

/**
 * 侧边栏标签 — 主页固定，其他标签按用户配置显示
 * 字段 key 与 useSidebarTabs 的 SidebarTabsConfig 严格对应
 */
type TabKey = keyof SidebarTabsConfig;

interface SidebarItem {
  title: string;
  url: string;
  icon: typeof Home;
  /** 是否受 SidebarTabsConfig 控制；undefined / "always" 表示始终显示 */
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
    title: "AI 技能",
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

export function AppSidebar() {
  const location = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [tabsConfig] = useSidebarTabs();

  // 根据用户配置过滤 — "always" 永远显示，其他按 tabKey 查询开关
  const visibleItems = items.filter((item) => {
    if (item.tabKey === "always" || !item.tabKey) return true;
    return tabsConfig[item.tabKey];
  });

  return (
    // 外框本身占满视口高度（不给 pt-10），让位的 40px 放在 SidebarContent 上。
    // 之前 pt-10 挂在外层 fixed 容器上，配合 h-svh（border-box）会让内容盒
    // 变成 100svh − 40px，玻璃外框因此比视口矮 40px，页脚开关也跟着悬在半空。
    <Sidebar collapsible="icon">
      <SidebarContent className="pt-10">
        <SidebarGroup>
          <SidebarGroupContent>
            {/* nav 地标：读屏用户靠它识别"这是主导航"。 */}
            <nav aria-label="主导航">
              <SidebarMenu>
                {visibleItems.map((item) => (
                  <SidebarMenuItem key={item.title} data-active={location.pathname === item.url}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={location.pathname === item.url}>
                      {/* 用 react-router 的 Link 而不是 <a onClick>：
                          <a> 没有 href 时按 HTML 规范不可聚焦、Enter 不触发、
                          也没有 link 角色，整列导航等于只能用鼠标点，中键/ctrl+点击
                          打开新标签页同样失效。Link 会渲染真实 href 并自行处理点击。 */}
                      <Link
                        to={item.url}
                        aria-current={location.pathname === item.url ? "page" : undefined}
                        data-active={location.pathname === item.url}
                        /* 激活态只保留底色 + 前景色（DESIGN.md §Sidebar）。
                           之前的 shadow-sm / ring-1 / 3px 强调条 / hover 辉光 /
                           缩放弹跳是五重叠加，其中强调条还是同色叠同色
                           （--primary 与 --sidebar-primary 都是 195 80% 38%），
                           在 teal 填充上根本看不见 —— 全部已随 index.css 一起移除。 */
                        className={`flex items-center gap-3 px-2 py-1.5 text-sm font-medium rounded-md sidebar-menu-btn ${
                          location.pathname === item.url
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`}>
                        <item.icon className="h-4 w-4" />
                        {/* 侧栏可拖到 152px，比"力扣分类"四字还窄。
                            不加 nowrap 的话文字会折成两行、把菜单项撑高一倍；
                            这里改成裁切，宽度由 SidebarMenuButton 的 truncate 兜住。 */}
                        <span className="truncate whitespace-nowrap">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* 收起/展开开关 —— 放页脚。
          DESIGN.md §Sidebar 一直写的就是 "Footer: 侧边栏收起/展开 toggle"，
          之前把它塞在 SidebarHeader 里，偏离了自己的规范：不占标题栏的高度，
          却又在导航列表正上方多出一整行、里面只有一枚孤零零的图标。
          那一行既不像标题（没有标识文字），也不像导航（不跳转任何页面），
          于是读起来就是个悬在半空的杂物 —— 这也正是它显得突兀的原因。

          挪到页脚后有两点改善：
          1. 位置有理由。顶部归标题栏、底部归视图开关，是桌面侧栏的通用分区，
             不再需要额外解释它为什么在那儿。
          2. 视觉上并入列表。这一行复用 SidebarMenuButton，和导航项共用同一套
             几何（8px 内边距、16px 图标、6px 圆角、同一套 hover / 按下反馈），
             只是被推到了底部 —— 读起来就是"列表的最后一行"，而不是另一个东西。
          折叠态下只剩图标居中显示，与折叠态的导航项行为一致。 */}
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
                {/* 图标对应目标状态 —— 不做旋转 hack */}
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