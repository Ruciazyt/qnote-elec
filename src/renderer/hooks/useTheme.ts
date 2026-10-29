import { useSyncExternalStore } from "react";

/**
 * 应用主题
 *
 * 设计要点：
 * 1. 用模块级 store + useSyncExternalStore，而不是每个组件各写一份 useState。
 *    主题是全局唯一状态，多处订阅（设置页开关、Excalidraw 等）必须同源，
 *    否则会出现"设置页显示深色、别的组件还停在浅色"的不同步。
 * 2. class 挂在 documentElement 上 —— index.css 的 .dark 选择器依赖它，
 *    而且要在 React 挂载前就位，所以 index.html 里另有一段内联脚本兜底（防闪白）。
 * 3. colorScheme 同步设置，让原生滚动条、下拉、表单控件也跟着变暗，
 *    只改 CSS 变量的话这些原生部件仍是浅色。
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "qnote-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // localStorage 不可用（隐私模式等）时退回跟随系统
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
  // 让浏览器原生部件（滚动条、select、日期选择器等）跟随主题
  root.style.colorScheme = resolved;
}

// ── 外部 store ──────────────────────────────────────────────
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
    // 存不下就只在本次会话生效
  }
  applyTheme(currentResolved);
  emit();
}

/** 在 React 挂载前调用一次，把 class 和 colorScheme 落到 DOM 上 */
export function initTheme() {
  applyTheme(currentResolved);
}

// 跟随系统时，系统主题一变就跟着变
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
    // 老内核兜底
    (mq as MediaQueryList).addListener(onSystemChange);
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  const resolvedTheme = useSyncExternalStore(subscribe, getResolvedTheme, getResolvedTheme);
  return { theme, resolvedTheme, setTheme };
}
