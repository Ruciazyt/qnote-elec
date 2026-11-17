import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./island.css";
import { IslandApp } from "./IslandApp";
import { initTheme } from "@/hooks/shell/useTheme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IslandApp />
  </StrictMode>
);
