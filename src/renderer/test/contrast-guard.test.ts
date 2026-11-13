import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error scripts/ 下是 .mjs，没有类型声明
import { buildMatrix } from "../../../scripts/check-contrast.mjs";
import { DOC_NUMBER_EXCEPTIONS } from "./contrast-doc-exceptions";

/**
 * 对比度守卫：钉规则，不钉小数
 *
 * 两半：
 *   1. 阈值 —— 规范认可的组合必须达标，规范禁用的组合必须不达标。
 *      断言的是「规则与当前 token 是否还自洽」，
 *      不是把 4.93 这种小数写死 —— token 一动就红太脆。
 *      哪天某个数越过了判定线，说明 token 变了、规范要跟着改，这条会提醒。
 *   2. 出处 —— 文档里出现的每个对比度数字都必须能在脚本矩阵里找到。
 *      谁改了 token 没同步文档，CI 直接红。
 *
 * 矩阵来自 scripts/check-contrast.mjs（全组唯一的出数口径）。
 */

interface MatrixRow {
  name: string;
  fg: string;
  bg: string;
  perBase: Record<string, number>;
  worst: number;
}

interface MatrixTheme {
  label: string;
  rows: MatrixRow[];
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const themes = buildMatrix() as MatrixTheme[];
const light = themes.find((t) => t.label.includes("浅色"));
const dark = themes.find((t) => t.label.includes("暗色"));
if (!light || !dark) throw new Error("对比度矩阵里没有浅色/暗色两套主题");

/** 取矩阵里的一格 */
function cell(theme: MatrixTheme, fg: string, bg: string): MatrixRow {
  const row = theme.rows.find((r) => r.fg === fg && r.bg === bg);
  if (!row) throw new Error(`矩阵里没有「${fg} 压 ${bg}」这一格`);
  return row;
}

/** AA 正文线 */
const AA = 4.5;

describe("对比度阈值（钉规则，不钉小数）", () => {
  it("浅色：品牌色作文字只能落在无品牌底纹处", () => {
    // 规范认可：没有品牌底纹时，品牌色作文字达标
    expect(cell(light, "primary", "card").worst).toBeGreaterThanOrEqual(AA);
    expect(cell(light, "primary", "background").worst).toBeGreaterThanOrEqual(AA);

    // 规范禁用：任何品牌底纹都不过线（/5 就已经 4.42）
    for (const tint of ["primary/5", "primary/10", "primary/15", "primary/20"]) {
      expect(cell(light, "primary", tint).worst).toBeLessThan(AA);
    }
  });

  it("浅色：品牌强档作文字的底纹上限是 /15，/20 禁用", () => {
    expect(cell(light, "primary-strong", "card").worst).toBeGreaterThanOrEqual(AA);
    expect(cell(light, "primary-strong", "background").worst).toBeGreaterThanOrEqual(AA);

    for (const tint of ["primary/5", "primary/10", "primary/15"]) {
      expect(cell(light, "primary-strong", tint).worst).toBeGreaterThanOrEqual(AA);
    }
    expect(cell(light, "primary-strong", "primary/20").worst).toBeLessThan(AA);
  });

  it("暗色：品牌色与品牌强档在品牌底纹上都达标，/20 不禁用", () => {
    // 暗色主题的 brand 是亮色，底纹压上去反而更清楚 —— 禁令只对浅色成立
    for (const tint of ["primary/5", "primary/10", "primary/15", "primary/20"]) {
      expect(cell(dark, "primary", tint).worst).toBeGreaterThanOrEqual(AA);
      expect(cell(dark, "primary-strong", tint).worst).toBeGreaterThanOrEqual(AA);
    }
    expect(cell(dark, "primary", "card").worst).toBeGreaterThanOrEqual(AA);
    expect(cell(dark, "primary-strong", "card").worst).toBeGreaterThanOrEqual(AA);
  });

  it("已知不过线、等着修的组合（修好后会红，提醒更新任务单）", () => {
    // 暗色 destructive 压 card 3.79、压 background 3.99 —— 不过 AA 正文线。
    // 这是任务单里挂着的一条；令牌层把它调过 4.5 之后本条会红，
    // 那时把任务单那条划掉、本条也删掉。
    expect(cell(dark, "destructive", "card").worst).toBeLessThan(AA);
    expect(cell(dark, "destructive", "background").worst).toBeLessThan(AA);

    // 浅色 destructive 达标，别被暗色那条带偏
    expect(cell(light, "destructive", "card").worst).toBeGreaterThanOrEqual(AA);
  });
});

describe("文档里的对比度数字必须能在矩阵里找到出处", () => {
  /** 矩阵里出现过的每一个值 */
  const known = new Set<string>();
  for (const theme of themes) {
    for (const row of theme.rows) {
      known.add(row.worst.toFixed(2));
      for (const v of Object.values(row.perBase)) known.add(v.toFixed(2));
    }
  }

  const exceptions = new Set(DOC_NUMBER_EXCEPTIONS);

  /** 要核对的文档与注释 */
  const files = [
    "DESIGN.md",
    "docs/UI-GUIDELINES.md",
    "docs/UI-AUDIT-2026-11-05.md",
    "src/renderer/index.css",
    "src/renderer/tailwind.config.js",
    "src/renderer/components/clipboard/popup-index.css",
  ];

  it("没有查不到出处的对比度数字", () => {
    const bad: string[] = [];

    for (const rel of files) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue;

      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        // 数字段限界（{1,10}）—— 两个无界 \d+ 之间隔着 \. 时，
        // 长数字串上会平方级回溯（S5852）
        const re = /(\d{1,10}\.\d{1,10}):\s*1\b/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const value = m[1];
          if (known.has(value) || exceptions.has(value)) continue;
          bad.push(`${rel}:${i + 1}  ${value}  ← ${line.trim().slice(0, 90)}`);
        }
      });
    }

    expect(bad).toEqual([]);
  });

  it("例外清单里的数确实不在矩阵里（清单不是垃圾桶）", () => {
    const stale = DOC_NUMBER_EXCEPTIONS.filter((v) => known.has(v));
    // 有些数可能因为矩阵补了新组合而重新可复现 —— 那时从清单里删掉即可
    expect(stale).toEqual([]);
  });
});
