import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".json"],
    alias: {
      "@": path.resolve(__dirname, "."),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "sticky-note": path.resolve(__dirname, "sticky-note.html"),
        "popup-clipboard": path.resolve(__dirname, "popup-clipboard.html"),
        island: path.resolve(__dirname, "island.html"),
      },
    },
  },
  server: {
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
