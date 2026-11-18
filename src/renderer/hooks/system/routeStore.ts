const listeners = new Set<() => void>();

let currentPath = readPathFromHash();

function readPathFromHash(): string {
  if (typeof window === "undefined") return "/";
  const raw = window.location.hash.replace(/^#/, "");
  const path = raw.split("?")[0].split("#")[0];
  return path || "/";
}

export function getRoutePath(): string {
  return currentPath;
}

export function publishRoutePath(path: string): void {
  if (path === currentPath) return;
  currentPath = path;
  listeners.forEach((listener) => listener());
}

export function subscribeRoutePath(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
