import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";


const RENDERER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = path.resolve(RENDERER_DIR, "..", "..");

const CSS_TEXT = readFileSync(path.join(RENDERER_DIR, "index.css"), "utf8");
const TAILWIND_TEXT = readFileSync(path.join(RENDERER_DIR, "tailwind.config.js"), "utf8");
const GUIDELINES_TEXT = readFileSync(path.join(REPO_DIR, "docs", "UI-GUIDELINES.md"), "utf8");

function cssBlock(lines: string[], startIdx: number): string[] {
  const out: string[] = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    if (lines[i].trim() === "}") break;
    out.push(lines[i]);
  }
  return out;
}

const CSS_LINES = CSS_TEXT.split(/\r?\n/);
const ROOT_IDX = CSS_LINES.findIndex((l) => l.trim() === ":root {");
const DARK_IDX = CSS_LINES.findIndex((l) => l.trim() === ".dark {");
const LIGHT_CSS = cssBlock(CSS_LINES, ROOT_IDX);
const DARK_CSS = cssBlock(CSS_LINES, DARK_IDX);

function tokenIn(block: string[], name: string): string | undefined {
  for (const line of block) {
    const m = line.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`));
    if (m) return m[1].trim();
  }
  return undefined;
}

function countToken(block: string[], name: string): number {
  return block.filter((line) => new RegExp(`^\\s*--${name}:`).test(line)).length;
}

function parseHsl(value: string): [number, number, number] {
  const [h, s, l] = value.trim().split(/\s+/).map((part) => parseFloat(part));
  return [h, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (h % 360) / 60;
  const X = C * (1 - Math.abs((hp % 2) - 1));
  const rgb =
    hp < 1 ? [C, X, 0]
    : hp < 2 ? [X, C, 0]
    : hp < 3 ? [0, C, X]
    : hp < 4 ? [0, X, C]
    : hp < 5 ? [X, 0, C]
    : [C, 0, X];
  const m = L - C / 2;
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m].map((v) => v * 255) as [number, number, number];
}

function luminance(rgb: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function contrastOfTokens(fgToken: string, bgToken: string): number {
  return contrast(hslToRgb(parseHsl(fgToken)), hslToRgb(parseHsl(bgToken)));
}

const SUCCESS_LIGHT = "152 60% 32%";
const SUCCESS_DARK = "152 58% 55%";

describe("语义色 token：success 的取值契约", () => {
  it("浅色 --success 是定案值 152 60% 32%", () => {
    expect(tokenIn(LIGHT_CSS, "success")).toBe(SUCCESS_LIGHT);
  });

  it("暗色 --success 是定案值 152 58% 55%", () => {
    expect(tokenIn(DARK_CSS, "success")).toBe(SUCCESS_DARK);
  });

  it("每个主题里 --success 只定义一处：同名重复定义会互相覆盖", () => {
    expect(countToken(LIGHT_CSS, "success")).toBe(1);
    expect(countToken(DARK_CSS, "success")).toBe(1);
  });

  it("浅色 success 当文字色落在卡片底上过 4.5:1", () => {
    expect(contrastOfTokens(SUCCESS_LIGHT, tokenIn(LIGHT_CSS, "card")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("暗色 success 当文字色落在卡片底上过 4.5:1", () => {
    expect(contrastOfTokens(SUCCESS_DARK, tokenIn(DARK_CSS, "card")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("success-foreground 两套主题都成对给，且压在 success 底色上够读", () => {
    const lightFg = tokenIn(LIGHT_CSS, "success-foreground");
    const darkFg = tokenIn(DARK_CSS, "success-foreground");

    expect(lightFg).toBe("0 0% 100%");
    expect(darkFg).toBe("220 15% 8%");
    expect(contrastOfTokens(lightFg!, SUCCESS_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOfTokens(darkFg!, SUCCESS_DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("规范文档里写着同一组定案值", () => {
    expect(GUIDELINES_TEXT).toContain(SUCCESS_LIGHT);
    expect(GUIDELINES_TEXT).toContain(SUCCESS_DARK);
  });
});

describe("语义色 token：success 的注册契约", () => {
  it("Tailwind 注册了 success / success-foreground", () => {
    expect(TAILWIND_TEXT).toMatch(
      /success:\s*\{[^}]*DEFAULT:\s*'hsl\(var\(--success\)\)'[^}]*foreground:\s*'hsl\(var\(--success-foreground\)\)'[^}]*\}/
    );
  });

  it("success 紧跟 destructive 之后：语义色一组", () => {
    const colorsBody = TAILWIND_TEXT.slice(TAILWIND_TEXT.indexOf("colors: {"));
    const keyOrder = Array.from(colorsBody.matchAll(/^\t{4}([a-z][a-zA-Z-]*):\s*\{/gm)).map((m) => m[1]);

    expect(keyOrder.indexOf("success")).toBe(keyOrder.indexOf("destructive") + 1);
  });
});
