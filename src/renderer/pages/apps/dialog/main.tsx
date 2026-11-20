import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import "./dialog.css";
import { DialogHost } from "./DialogHost";
import { initTheme } from "@/hooks/shell/useTheme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DialogHost />
  </StrictMode>
);
