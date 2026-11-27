import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "skills-tools-collapsed-groups";

function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function useToolGroupCollapse() {
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
    }
  }, [collapsed]);

  const isCollapsed = useCallback(
    (group: string) => collapsed.includes(group),
    [collapsed]
  );

  const toggle = useCallback((group: string) => {
    setCollapsed((prev) =>
      prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group]
    );
  }, []);

  const collapseAll = useCallback((groups: string[]) => {
    setCollapsed(groups);
  }, []);

  const expandAll = useCallback(() => {
    setCollapsed([]);
  }, []);

  return { isCollapsed, toggle, collapseAll, expandAll };
}
