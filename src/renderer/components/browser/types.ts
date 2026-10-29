/**
 * 内嵌浏览器的跨进程类型定义
 * 渲染进程与主进程 browserViewManager 的 BrowserTabState / BrowserState 严格对应
 */

/** 单个标签页的可序列化状态 — 主进程是唯一数据源 */
export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** 浏览器页整体状态 */
export interface BrowserState {
  tabs: BrowserTabState[];
  activeTabId: string | null;
}

/** 页面加载失败事件负载 */
export interface BrowserLoadError {
  tabId: string;
  url: string;
  errorCode: number;
  errorDescription: string;
}

/** 书签记录 — 与主进程 browser_bookmark 表一一对应 */
export interface BookmarkRow {
  id: number;
  /** 部分站点取不到标题，存 null，界面回退显示 url */
  title: string | null;
  url: string;
  created_at: string;
  updated_at: string;
}
