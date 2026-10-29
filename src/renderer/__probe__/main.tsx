import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import "./index.css";
import App from "./App.tsx";
import { initTheme } from "./hooks/useTheme";

// 兜底：index.html 的内联脚本通常已经设好了，这里保证手动调用切换时也一致
initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
