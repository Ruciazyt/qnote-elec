#!/usr/bin/env node
/**
 * token 对比度矩阵 —— 文档里每个对比度数字的唯一出处
 *
 * 用法：
 *   node scripts/check-contrast.mjs            # 浅色 + 暗色都打
 *   node scripts/check-contrast.mjs --light    # 只打浅色
 *   node scripts/check-contrast.mjs --dark     # 只打暗色
 *   node scripts/check-contrast.mjs --json     # 机器可读
 *
 * 无第三方依赖，只用 Node 内置模块。
 *
 * 计算口径（全组统一，文档里的数只能出自这套）：
 *   - WCAG 2.x 相对亮度公式
 *   - sRGB 线性化阈值 0.03928 / 0.055
 *   - HSL 按 CSS 规范转 sRGB
 *   - 透明档先把源色与实际底色做 alpha 合成，再算
 *   - 底色只有两种：--card 与 --background，结论取更差的那个
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cssPath = path.join(repoRoot, "src/renderer/index.css");

/* ============================================================
 * 1. 读 token
 * ============================================================ */

/** 取一个 CSS 块里的 --token: 值 */
function tokensInBlock(css, blockStart) {
  const start = css.indexOf(blockStart);
  if (start < 0) return null;
  const open = css.indexOf("{", start);
  if (open < 0) return null;

  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const body = css.slice(open + 1, end);
  const out = new Map();
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** "195 80% 34%" → { h, s, l }；不是颜色的返回 null */
function parseHsl(value) {
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

const css = fs.readFileSync(cssPath, "utf8");
const lightRaw = tokensInBlock(css, ":root") ?? new Map();
const darkRaw = tokensInBlock(css, ".dark") ?? new Map();

/* ============================================================
 * 2. 颜色数学
 * ============================================================ */

/** HSL → sRGB（0..1），按 CSS 规范 */
function hslToRgb(h, s, l) {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = s / 100;
  const ll = l / 100;

  if (ss === 0) return [ll, ll, ll];

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;

  const hue2rgb = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  return [hue2rgb(hh + 1 / 3), hue2rgb(hh), hue2rgb(hh - 1 / 3)];
}

/** sRGB 通道线性化（WCAG 2.x 阈值 0.03928 / 0.055） */
function linearize(c) {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 相对亮度 */
function luminance([r, g, b]) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * 源色按 alpha 叠到底色上（浏览器在 sRGB 空间合成）
 *
 * 全程用浮点，不做 8-bit 取整 —— 与 WCAG 计算器（及全组统一口径）对得上；
 * 取整会让 primary 白底从 4.93 变成 4.95，与文档里已有的数对不上。
 */
function composite(src, dst, alpha) {
  return [0, 1, 2].map((i) => src[i] * alpha + dst[i] * (1 - alpha));
}

/** 对比度 */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ============================================================
 * 3. 解析 token → 颜色
 * ============================================================ */

function buildPalette(raw) {
  const colors = new Map();
  for (const [name, value] of raw) {
    const hsl = parseHsl(value);
    if (!hsl) continue;
    colors.set(name, hslToRgb(hsl.h, hsl.s, hsl.l));
  }
  return colors;
}

/**
 * 取一个 token 的颜色；支持 "primary/10" 这种带透明档的写法
 *
 * 透明档不在这里合成 —— 合成要看它压在什么底上，交给 resolveBg。
 */
function tokenColor(colors, spec) {
  const [name, alphaRaw] = spec.split("/");
  const rgb = colors.get(name);
  if (!rgb) return null;

  let alpha = 1;
  if (alphaRaw !== undefined) {
    if (alphaRaw.startsWith("[")) {
      alpha = Number(alphaRaw.slice(1, -1)) / 100; // bg-primary/[0.08]
    } else {
      alpha = Number(alphaRaw) / 100;
    }
  }
  return { rgb, alpha };
}

/* ============================================================
 * 4. 矩阵
 * ============================================================ */

/** 底色基底 —— 只有这两种，结论取更差的那个 */
const BASE_BACKGROUNDS = ["card", "background"];

/**
 * 要算的组合
 *
 * fg = 文字色，bg = 文字压的底（底再压在 card / background 上）
 */
const COMBOS = [
  ["正文", "foreground", "background"],
  ["正文", "foreground", "card"],
  ["卡片正文", "card-foreground", "card"],
  ["次要文字", "muted-foreground", "background"],
  ["次要文字", "muted-foreground", "card"],
  ["次要文字 /70", "muted-foreground/70", "background"],
  ["次要文字 /70", "muted-foreground/70", "card"],
  ["次要文字 /60", "muted-foreground/60", "background"],
  ["次要文字 /60", "muted-foreground/60", "card"],
  ["次要文字 /80", "muted-foreground/80", "background"],
  ["次要文字 /80", "muted-foreground/80", "card"],
  ["次要文字 /85", "muted-foreground/85", "background"],
  ["次要文字 /85", "muted-foreground/85", "card"],
  ["品牌色文字", "primary", "background"],
  ["品牌色文字", "primary", "card"],
  ["品牌色 /40", "primary/40", "background"],
  ["品牌色 /40", "primary/40", "card"],
  ["品牌色 /50", "primary/50", "background"],
  ["品牌色 /50", "primary/50", "card"],
  ["品牌色 /60", "primary/60", "background"],
  ["品牌色 /60", "primary/60", "card"],
  ["品牌色 /70", "primary/70", "background"],
  ["品牌色 /70", "primary/70", "card"],
  ["品牌色 /80", "primary/80", "background"],
  ["品牌色 /80", "primary/80", "card"],
  ["品牌色 /85", "primary/85", "background"],
  ["品牌色 /85", "primary/85", "card"],
  ["品牌强档文字", "primary-strong", "background"],
  ["品牌强档文字", "primary-strong", "card"],
  ["品牌色压 /5", "primary", "primary/5"],
  ["品牌色压 /10", "primary", "primary/10"],
  ["品牌色压 /15", "primary", "primary/15"],
  ["品牌色压 /20", "primary", "primary/20"],
  ["品牌强档压 /5", "primary-strong", "primary/5"],
  ["品牌强档压 /10", "primary-strong", "primary/10"],
  ["品牌强档压 /15", "primary-strong", "primary/15"],
  ["品牌强档压 /20", "primary-strong", "primary/20"],
  ["品牌色 /80 压 /10", "primary/80", "primary/10"],
  ["反白字压品牌色", "primary-foreground", "primary"],
  ["危险色文字", "destructive", "background"],
  ["危险色文字", "destructive", "card"],
  ["成功色文字", "success", "background"],
  ["成功色文字", "success", "card"],
  ["警告色文字", "warning", "background"],
  ["警告色文字", "warning", "card"],
  ["成功色压 /10", "success", "success/10"],
  ["成功色压 /15", "success", "success/15"],
  ["成功色压 /20", "success", "success/20"],
  ["警告色压 /10", "warning", "warning/10"],
  ["警告色压 /15", "warning", "warning/15"],
  ["警告色压 /20", "warning", "warning/20"],
  ["危险色压 /10", "destructive", "destructive/10"],
  ["危险色压 /15", "destructive", "destructive/15"],
  ["危险色压 /20", "destructive", "destructive/20"],
  ["链接色", "link", "background"],
  ["链接色", "link", "card"],
  ["次要文字压 muted", "muted-foreground", "muted"],
  ["正文压 muted", "foreground", "muted"],
  ["正文压 secondary", "foreground", "secondary"],
  ["正文压 accent", "foreground", "accent"],
  ["侧栏激活文字", "sidebar-primary", "background"],
  ["侧栏激活文字", "sidebar-primary", "card"],
  ["反白字压侧栏品牌色", "sidebar-primary-foreground", "sidebar-primary"],
];

const AA = 4.5;
const AAA = 7;
const AA_LARGE = 3;

function computeTheme(colors, label) {
  const rows = [];

  for (const [name, fgSpec, bgSpec] of COMBOS) {
    const fg = tokenColor(colors, fgSpec);
    const bg = tokenColor(colors, bgSpec);
    if (!fg || !bg) continue;

    const perBase = {};
    for (const base of BASE_BACKGROUNDS) {
      const baseColor = colors.get(base);
      if (!baseColor) continue;

      // 底：半透明档先叠在基底上，再叠回基底
      const bgLayered = composite(bg.rgb, baseColor, bg.alpha);
      // 字：半透明档叠在合成后的底上
      const fgLayered = composite(fg.rgb, bgLayered, fg.alpha);

      perBase[base] = contrast(fgLayered, bgLayered);
    }

    const values = Object.values(perBase);
    const worst = Math.min(...values);

    rows.push({
      name,
      fg: fgSpec,
      bg: bgSpec,
      perBase,
      worst,
      aa: worst >= AA,
      aaa: worst >= AAA,
      large: worst >= AA_LARGE,
    });
  }

  return { label, rows };
}

function pad(text, width) {
  const s = String(text);
  const len = [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, width - len));
}

function printTheme(theme) {
  console.log(`\n=== ${theme.label} ===`);
  console.log(
    `${pad("组合", 22)}${pad("前景", 26)}${pad("底", 22)}${pad("--card", 9)}${pad("--bg", 9)}${pad("取差", 8)}判定`
  );
  console.log("-".repeat(110));

  for (const r of theme.rows) {
    const card = r.perBase.card;
    const bg = r.perBase.background;
    const verdict = r.aaa ? "AAA" : r.aa ? "AA" : r.large ? "仅大字" : "不过线";
    console.log(
      `${pad(r.name, 22)}${pad(r.fg, 26)}${pad(r.bg, 22)}` +
        `${pad(card !== undefined ? card.toFixed(2) : "-", 9)}` +
        `${pad(bg !== undefined ? bg.toFixed(2) : "-", 9)}` +
        `${pad(r.worst.toFixed(2), 8)}${verdict}`
    );
  }

  const bad = theme.rows.filter((r) => !r.aa);
  console.log(`\nAA（4.5）不过线：${bad.length} 条`);
  for (const r of bad) {
    console.log(`  - ${r.name}：${r.fg} 压 ${r.bg} → ${r.worst.toFixed(2)}`);
  }
}

/* ============================================================
 * 5. 入口
 * ============================================================ */

/**
 * 矩阵（可被别的脚本 import —— 守卫测试与文档核对都从这里取数）
 *
 * 返回 [{ label, rows: [{ name, fg, bg, perBase, worst, aa, aaa, large }] }]
 */
export function buildMatrix({ light = true, dark = true } = {}) {
  const themes = [];
  if (light) themes.push(computeTheme(buildPalette(lightRaw), "浅色主题（:root）"));
  if (dark) themes.push(buildThemeSafe(darkRaw));
  return themes;
}

function buildThemeSafe(raw) {
  const palette = buildPalette(raw);
  // 暗色块里没重定义的 token 继承浅色
  for (const [name, rgb] of buildPalette(lightRaw)) {
    if (!palette.has(name)) palette.set(name, rgb);
  }
  return computeTheme(palette, "暗色主题（.dark）");
}

// 只有被当命令行跑的时候才打印；被 import 时安静退出
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const args = process.argv.slice(2);
  const wantLight = args.length === 0 || args.includes("--light");
  const wantDark = args.length === 0 || args.includes("--dark");
  const wantJson = args.includes("--json");

  const themes = buildMatrix({ light: wantLight, dark: wantDark });

  if (wantJson) {
    console.log(JSON.stringify(themes, null, 2));
  } else {
    console.log("token 对比度矩阵");
    console.log(`口径：WCAG 2.x 相对亮度；sRGB 线性化 0.03928/0.055；HSL 按 CSS 转 sRGB；透明档先 alpha 合成；底取 --card 与 --background 更差者`);
    console.log(`来源：${path.relative(repoRoot, cssPath)}`);
    for (const theme of themes) printTheme(theme);
  }
}
