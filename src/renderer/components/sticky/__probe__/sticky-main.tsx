import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// App 的设计变量与基础样式 —— 与主窗口逐字相同，便签配色因此天然一致
import "@/index.css";
import "./sticky-index.css";
import { StickyNoteApp } from "./StickyNoteApp";
import { initTheme, setTheme } from "@/hooks/useTheme";

// 便签窗口与主窗口共用默认 session，主题设置在 localStorage 里是共享的。
// 这里再调一次 initTheme，保证用户在主窗口里刚改过主题时，
// 新撕下来的便签立刻就是对的颜色，而不是等下一次启动。
initTheme();

/**
 * 主窗口改了主题，这边立刻跟上
 *
 * 同源的另一个窗口写 localStorage 时，本窗口会收到 `storage` 事件。
 * 不监听的话，用户在设置里切了深色，已经贴在桌面上的便签还是旧的浅色 ——
 * 看着就像"便签跟 App 不是一套配色"。
 */
window.addEventListener("storage", (event) => {
  if (event.key !== "qnote-theme" || !event.newValue) return;
  const theme = event.newValue;
  if (theme === "light" || theme === "dark" || theme === "system") {
    setTheme(theme);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StickyNoteApp />
  </StrictMode>
);
