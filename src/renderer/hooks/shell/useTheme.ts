import { useSyncExternalStore } from "react";


export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "qnote-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
  }
  return "system";
}

function prefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches === true;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return prefersDark() ? "dark" : "light";
  return theme;
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

let currentTheme: Theme = readStoredTheme();
let currentResolved: ResolvedTheme = resolveTheme(currentTheme);
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getTheme = () => currentTheme;
const getResolvedTheme = () => currentResolved;

export function setTheme(theme: Theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  currentResolved = resolveTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
  }
  applyTheme(currentResolved);
  emit();
}

export function initTheme() {
  applyTheme(currentResolved);
}

if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (currentTheme !== "system") return;
    const next: ResolvedTheme = mq.matches ? "dark" : "light";
    if (next === currentResolved) return;
    currentResolved = next;
    applyTheme(next);
    emit();
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onSystemChange);
  } else if (typeof (mq as MediaQueryList).addListener === "function") {
    (mq as MediaQueryList).addListener(onSystemChange);
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  const resolvedTheme = useSyncExternalStore(subscribe, getResolvedTheme, getResolvedTheme);
  return { theme, resolvedTheme, setTheme };
}
