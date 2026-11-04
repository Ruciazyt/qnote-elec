import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * 渲染层测试配置
 *
 * 别名必须与 vite.config.ts 保持一致 —— 测试里 `@/hooks/useCollapsedState`
 * 和运行时走的不是同一套解析规则时，测的就不是同一份代码了。
 * 改 vite.config.ts 的 alias 时记得同步改这里。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // 主进程和渲染进程共用的模块（src/shared），与 vite.config.ts 保持一致。
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    // 渲染层跑在 DOM 里，默认用 jsdom。
    // 主进程类的用例可以在文件顶部写 `// @vitest-environment node` 单独切。
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    restoreMocks: true,
  },
});
