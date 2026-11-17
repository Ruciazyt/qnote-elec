import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error scripts/ 下是 .mjs，没有类型声明
import { buildMatrix } from "../../../scripts/check-contrast.mjs";
import { DOC_NUMBER_EXCEPTIONS } from "./contrast-doc-exceptions";


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

function cell(theme: MatrixTheme, fg: string, bg: string): MatrixRow {
  const row = theme.rows.find((r) => r.fg === fg && r.bg === bg);
  if (!row) throw new Error(`矩阵里没有「${fg} 压 ${bg}」这一格`);
  return row;
}

const AA = 4.5;

describe("对比度阈值（钉规则，不钉小数）", () => {
  it("浅色：品牌色作文字只能落在无品牌底纹处", () => {
    expect(cell(light, "primary", "card").worst).toBeGreaterThanOrEqual(AA);
    expect(cell(light, "primary", "background").worst).toBeGreaterThanOrEqual(AA);

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
    for (const tint of ["primary/5", "primary/10", "primary/15", "primary/20"]) {
      expect(cell(dark, "primary", tint).worst).toBeGreaterThanOrEqual(AA);
      expect(cell(dark, "primary-strong", tint).worst).toBeGreaterThanOrEqual(AA);
    }
    expect(cell(dark, "primary", "card").worst).toBeGreaterThanOrEqual(AA);
    expect(cell(dark, "primary-strong", "card").worst).toBeGreaterThanOrEqual(AA);
  });

  it("已知不过线、等着修的组合（修好后会红，提醒更新任务单）", () => {
    expect(cell(dark, "destructive", "card").worst).toBeLessThan(AA);
    expect(cell(dark, "destructive", "background").worst).toBeLessThan(AA);

    expect(cell(light, "destructive", "card").worst).toBeGreaterThanOrEqual(AA);
  });
});

describe("文档里的对比度数字必须能在矩阵里找到出处", () => {
  const known = new Set<string>();
  for (const theme of themes) {
    for (const row of theme.rows) {
      known.add(row.worst.toFixed(2));
      for (const v of Object.values(row.perBase)) known.add(v.toFixed(2));
    }
  }

  const exceptions = new Set(DOC_NUMBER_EXCEPTIONS);

  const files = [
    "DESIGN.md",
    "docs/UI-GUIDELINES.md",
    "docs/UI-AUDIT-2026-11-05.md",
    "src/renderer/index.css",
    "src/renderer/tailwind.config.js",
    "src/renderer/pages/clipboard-popup/popup-index.css",
  ];

  it("没有查不到出处的对比度数字", () => {
    const bad: string[] = [];

    for (const rel of files) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue;

      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
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
    expect(stale).toEqual([]);
  });
});
