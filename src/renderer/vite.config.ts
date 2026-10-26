import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // 主进程和渲染进程共用的模块（src/shared）。
      // 在 Vite root 之外，必须显式起别名 —— 用相对路径也会被 dev server 的 fs 限制挡住。
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      /**
       * 多页构建
       *
       * 除了主窗口，还要产出「屏幕便签」页面 —— 它跑在一个独立的透明
       * BrowserWindow 里，必须是单独的入口，不能挂在主窗口的 bundle 上
       * （主窗口那套 bundle 带着 Excalidraw、AI 等一大堆东西，便签只要一张纸）。
       *
       * 产物落在 dist/renderer/sticky-note.html，打包后位于
       * resources/renderer/dist/sticky-note.html。
       */
      input: {
        main: path.resolve(__dirname, "index.html"),
        "sticky-note": path.resolve(__dirname, "sticky-note.html"),
      },
    },
  },
  server: {
    fs: {
      // 允许访问到项目根目录（加载 Electron 主项目的依赖/资源）
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
