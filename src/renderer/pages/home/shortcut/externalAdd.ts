import { useEffect } from "react";

let pending: string | null = null;
const listeners = new Set<(target: string) => void>();

export function pushExternalAdd(target: string): void {
  if (!target) return;
  pending = target;
  listeners.forEach((listener) => listener(target));
}

export function takeExternalAdd(): string | null {
  const value = pending;
  pending = null;
  return value;
}

function subscribe(listener: (target: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useExternalAddShortcut(handler: (target: string) => void): void {
  useEffect(() => {
    const initial = takeExternalAdd();
    if (initial) handler(initial);
    return subscribe(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
