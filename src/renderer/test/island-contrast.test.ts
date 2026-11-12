import { describe, it, expect } from "vitest";
// @ts-expect-error scripts/ 下是 .mjs，没有类型声明
import { buildIslandMatrix } from "../../../scripts/build/check-island-contrast.mjs";

/**
 * 灵动岛配色的对比度守卫
 *
 * 仓库的 CSS 文字对比度守卫只认 index.css 里的主题 token，
 * 岛的 --island-* 是私有 token，会被跳过 —— 和 --sticky-ink 一样。
 * 这条用例把岛的两套主题单独钉住：正文过 4.5:1，图形（圆点、光标、
 * 按钮上的对勾）过 3:1。
 */
describe("灵动岛配色", () => {
  const rows = buildIslandMatrix();

  it("浅色与暗色各有一组，token 都在", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.theme))).toEqual(new Set(["浅色", "暗色"]));
    const missing = rows.filter((r) => r.ratio === null);
    expect(missing).toEqual([]);
  });

  it("每一组前景压背景都过线", () => {
    const bad = rows
      .filter((r) => r.ratio !== null && r.ratio < r.min)
      .map((r) => `${r.theme} ${r.fg} 压 ${r.bg} ${r.ratio!.toFixed(2)}（要 ${r.min}）`);
    expect(bad).toEqual([]);
  });
});
