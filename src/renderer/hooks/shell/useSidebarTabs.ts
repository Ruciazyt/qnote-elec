import { useCallback, useEffect, useState } from "react";

export interface SidebarTabsConfig {
  notes: boolean;
  todos: boolean;
  leetcode: boolean;
  browser: boolean;
  plugins: boolean;
  settings: boolean;
}

export const DEFAULT_SIDEBAR_TABS: SidebarTabsConfig = {
  notes: true,
  todos: false,
  leetcode: false,
  browser: true,
  plugins: true,
  settings: true,
};

const STORAGE_KEY = "qnote-sidebar-tabs";
const EVENT_NAME = "qnote-sidebar-tabs-changed";

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
      browser: typeof parsed.browser === "boolean" ? parsed.browser : DEFAULT_SIDEBAR_TABS.browser,
      plugins:
        typeof parsed.plugins === "boolean"
          ? parsed.plugins
          : DEFAULT_SIDEBAR_TABS.plugins,
      settings:
        typeof parsed.settings === "boolean" ? parsed.settings : DEFAULT_SIDEBAR_TABS.settings,
    };
  } catch {
    return { ...DEFAULT_SIDEBAR_TABS };
  }
}

export function saveSidebarTabs(config: SidebarTabsConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: config }));
  } catch {
  }
}

export function useSidebarTabs(): [SidebarTabsConfig, (next: SidebarTabsConfig) => void] {
  const [config, setConfig] = useState<SidebarTabsConfig>(loadSidebarTabs);

  useEffect(() => {
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