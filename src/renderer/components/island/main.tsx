import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./island.css";
import { IslandApp } from "./IslandApp";
import { initTheme } from "@/hooks/useTheme";

// 岛也套用主窗口选好的主题；island.html 的内联脚本已提前设过一次，
// 这里保证用户中途改主题后岛依然一致
initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IslandApp />
  </StrictMode>
);
