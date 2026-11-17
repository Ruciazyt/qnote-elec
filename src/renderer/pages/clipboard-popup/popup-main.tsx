import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./popup-index.css";
import { ClipboardPopup } from "./ClipboardPopup";
import { initTheme } from "@/hooks/shell/useTheme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClipboardPopup />
  </StrictMode>
);
