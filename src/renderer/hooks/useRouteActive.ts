import { useLocation } from "react-router";

/**
 * 当前路由是否命中指定路径
 *
 * ## 为什么页面需要知道"自己是不是当前页"
 *
 * App.tsx 把路由从 <Routes> 换成了 keep-alive：访问过的页面保持挂载，
 * 切走只是 display:none。这样切页不再重挂载、不会重跑数据拉取。
 *
 * 但反过来，隐藏页面的 window/document 级监听器**依然在跑**。
 * react-router 只负责隐藏 DOM，不会替页面注销全局事件，于是需要页面自己判断：
 *
 *   - NotesPage 的 Ctrl+S / F2 若不加守卫，在主页按 Ctrl+S 会误存白板
 *   - BrowserPage 的 WebContentsView 显隐若挂在卸载上，切走后原生视图
 *     会一直盖在整个窗口上（因为卸载清理不再执行）
 *
 * @param path 该页面自己的路由，如 "/notes"
 */
export function useRouteActive(path: string): boolean {
  const { pathname } = useLocation();
  return pathname === path;
}
