import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

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
    // 扫描范围比本目录大：src/shared 与 src/main 里有一批纯逻辑
    // （清单解析、图片附件校验、AI 分块构建器）没有任何用例守着，
    // 它们却同时被主进程和渲染层依赖 —— 一处改错两边都坏。
    //
    // 这两个目录不在渲染层的 node_modules 依赖图里，用例只 import
    // 被测模块本身，不 import electron / knex，因此不需要额外 mock。
    //
    // ../database 也要扫：云端存储层（D1 客户端、共享存储抽象）同样
    // 是主进程与渲染层共用的纯逻辑，而且它是**双后端**的 ——
    // 本地与 D1 两套实现必须给出一样的行为，只能靠契约测试守住。
    //
    // ../../cloud-worker 是公共目录 Worker 的 SQL 白名单 ——
    // 它的地址是公开的，白名单一松数据库的全权就暴露在公网上，
    // 所以这一层必须有测试守着。
    // （它在**仓库根目录**，比 ../shared 那几个再高一层。）
    include: [
      "**/*.{test,spec}.{ts,tsx}",
      "../shared/**/*.{test,spec}.{ts,tsx}",
      "../main/**/*.{test,spec}.{ts,tsx}",
      "../database/**/*.{test,spec}.{ts,tsx}",
      "../../cloud-worker/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    restoreMocks: true,

    // 覆盖率报告 —— SonarCloud 要的是 lcov 格式
    //
    // 产出在 src/renderer/coverage/lcov.info，
    // 对应 sonar-project.properties 里的 sonar.javascript.lcov.reportPaths。
    // 不产出 lcov 的话，SonarCloud 侧的覆盖率会是 0，
    // 质量门禁里「新增代码覆盖率」那条必然红。
    coverage: {
      provider: "v8",
      // text-summary 给人看，lcov 给 SonarCloud 看
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["**/*.{ts,tsx}"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.d.ts",
        "**/test/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/vite.config.ts",
        "**/vitest.config.ts",
        "**/postcss.config.js",
        "**/tailwind.config.js",
      ],
    },
  },
});
