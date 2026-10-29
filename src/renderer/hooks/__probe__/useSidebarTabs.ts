import { useCallback, useEffect, useState } from "react";

/**
 * 侧边栏标签显示配置
 * - 主页 永远显示，不在此配置里
 * - 其他标签默认全部关闭，用户在设置页手动开启
 */
export interface SidebarTabsConfig {
  notes: boolean;
  todos: boolean;
  leetcode: boolean;
  browser: boolean;
  settings: boolean;
}

export const DEFAULT_SIDEBAR_TABS: SidebarTabsConfig = {
  // 笔记默认开启 —— 这是一个笔记应用，装完却看不见"笔记"入口是自相矛盾的。
  // Todo / 力扣属于可选场景，保持默认关闭。
  notes: true,
  todos: false,
  leetcode: false,
  // 浏览器默认开启 — 装完即可用
  browser: true,
  // 设置默认开启 — 否则用户没法进设置页开启其他标签（先有鸡还是先有蛋）
  settings: true,
};

const STORAGE_KEY = "qnote-sidebar-tabs";
const EVENT_NAME = "qnote-sidebar-tabs-changed";

/**
 * 从 localStorage 读取配置 — 容错解析，缺字段用默认值填充
 */
export function loadSidebarTabs(): SidebarTabsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIDEBAR_TABS };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_SIDEBAR_TABS };
    }
    return {
      notes: typeof parsed.notes === "boolean" ? parsed.notes : DEFAULT_SIDEBAR_TABS.notes,
      todos: typeof parsed.todos === "boolean" ? parsed.todos : DEFAULT_SIDEBAR_TABS.todos,
      leetcode:
        typeof parsed.leetcode === "boolean" ? parsed.leetcode : DEFAULT_SIDEBAR_TABS.leetcode,
      // 老版本 localStorage 里没有 browser 字段，回落默认值（开启）
      browser: typeof parsed.browser === "boolean" ? parsed.browser : DEFAULT_SIDEBAR_TABS.browser,
      settings:
        typeof parsed.settings === "boolean" ? parsed.settings : DEFAULT_SIDEBAR_TABS.settings,
    };
  } catch {
    return { ...DEFAULT_SIDEBAR_TABS };
  }
}

/**
 * 保存配置 + 通过 CustomEvent 通知同窗口内其他组件
 */
export function saveSidebarTabs(config: SidebarTabsConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: config }));
  } catch {
    // ignore
  }
}

/**
 * React Hook — 响应式订阅侧边栏标签配置
 *
 * - 初始值从 localStorage 读
 * - 同窗口其他组件通过 saveSidebarTabs 触发的 CustomEvent 自动同步
 * - 卸载时取消订阅
 */
export function useSidebarTabs(): [SidebarTabsConfig, (next: SidebarTabsConfig) => void] {
  const [config, setConfig] = useState<SidebarTabsConfig>(loadSidebarTabs);

  useEffect(() => {
    // 跨 storage 事件（其他窗口修改时也会收到，但同窗口主要靠 CustomEvent）
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<SidebarTabsConfig>).detail;
      if (detail && typeof detail === "object") {
        setConfig(detail);
      }
    };
    window.addEventListener(EVENT_NAME, onCustom);
    return () => {
      window.removeEventListener(EVENT_NAME, onCustom);
    };
  }, []);

  const update = useCallback((next: SidebarTabsConfig) => {
    setConfig(next);
    saveSidebarTabs(next);
  }, []);

  return [config, update];
}