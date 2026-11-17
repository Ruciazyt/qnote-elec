import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import "./sticky-index.css";
import { StickyNoteApp } from "./StickyNoteApp";
import { initTheme, setTheme } from "@/hooks/shell/useTheme";

initTheme();

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
