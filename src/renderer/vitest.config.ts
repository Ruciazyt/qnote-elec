import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: [
      "**/*.{test,spec}.{ts,tsx}",
      "../shared/**/*.{test,spec}.{ts,tsx}",
      "../main/**/*.{test,spec}.{ts,tsx}",
      "../database/**/*.{test,spec}.{ts,tsx}",
      "../../cloud-worker/**/*.{test,spec}.{ts,tsx}",
      "../../scripts/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    restoreMocks: true,

    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "./coverage",
      allowExternal: true,
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
