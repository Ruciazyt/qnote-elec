import { useEffect } from "react";

let pendingRelPath: string | null = null;
const listeners = new Set<(relPath: string) => void>();

export function pushIslandOpenNote(relPath: string): void {
  if (!relPath) return;
  pendingRelPath = relPath;
  listeners.forEach((listener) => listener(relPath));
}

export function takeIslandOpenNote(): string | null {
  const value = pendingRelPath;
  pendingRelPath = null;
  return value;
}

export function useIslandOpenNote(handler: (relPath: string) => void): void {
  useEffect(() => {
    const initial = takeIslandOpenNote();
    if (initial) handler(initial);
    const listener = (relPath: string) => handler(relPath);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
