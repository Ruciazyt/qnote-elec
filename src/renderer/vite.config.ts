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
  },
  server: {
    fs: {
      // 允许访问到项目根目录（加载 Electron 主项目的依赖/资源）
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
