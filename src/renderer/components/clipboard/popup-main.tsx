import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./popup-index.css";
import { ClipboardPopup } from "./ClipboardPopup";
import { initTheme } from "@/hooks/useTheme";

// 弹窗也套用主窗口选好的主题；popup-clipboard.html 的内联脚本已提前设过一次，
// 这里保证用户中途改主题后新弹出的窗口依然一致
initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClipboardPopup />
  </StrictMode>
);
