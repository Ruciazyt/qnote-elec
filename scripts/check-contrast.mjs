/**
 * token 对比度矩阵 —— 文档里每个对比度数字的唯一出处
 *
 * 用法：
 *   node scripts/check-contrast.mjs            # 浅色 + 暗色都打
 *   node scripts/check-contrast.mjs --light    # 只打浅色
 *   node scripts/check-contrast.mjs --dark     # 只打暗色
 *   node scripts/check-contrast.mjs --json --light --dark   # 机器可读
 *
 * ⚠ 这里**不要加 shebang**（`#!/usr/bin/env node`）。
 * 「shebang + CRLF」这个组合 vitest 解析不了，
 * `test/contrast-guard.test.ts` 会整个套件加载失败：
 *   SyntaxError: Invalid or unexpected token
 * （报在 import 那一行，看不出是脚本自己的问题。）
 * 根目录的 `.gitattributes` 已经把文本文件统一成 LF 检出（2026-11-05），
 * 但防线放在「不加 shebang」这一条上更稳 —— 万一哪个工具用 CRLF 落盘，
 * 失败的是整个对比度守卫，而不是一个脚本。
 * 这个文件一律用 `node scripts/check-contrast.mjs` 调用，shebang 没有用处。
 *
 * ⚠ `--json` 必须同时带 `--light --dark`：单独给 `--json` 时
 * `wantLight` / `wantDark` 都是 false，打出来的是空矩阵 `[]`。
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
export function composite(src, dst, alpha) {
  return [0, 1, 2].map((i) => src[i] * alpha + dst[i] * (1 - alpha));
}

/** 对比度 */
export function contrast(a, b) {
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
export function tokenColor(colors, spec) {
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
  // 2026-11-09 补：全仓实际用到的次级文字透明度档（scripts/audit-muted-text.mjs 扫出来的）
  ["次要文字 /25", "muted-foreground/25", "background"],
  ["次要文字 /25", "muted-foreground/25", "card"],
  ["次要文字 /30", "muted-foreground/30", "background"],
  ["次要文字 /30", "muted-foreground/30", "card"],
  ["次要文字 /40", "muted-foreground/40", "background"],
  ["次要文字 /40", "muted-foreground/40", "card"],
  ["次要文字 /45", "muted-foreground/45", "background"],
  ["次要文字 /45", "muted-foreground/45", "card"],
  ["次要文字 /50", "muted-foreground/50", "background"],
  ["次要文字 /50", "muted-foreground/50", "card"],
  ["次要文字 /55", "muted-foreground/55", "background"],
  ["次要文字 /55", "muted-foreground/55", "card"],
  ["次要文字 /65", "muted-foreground/65", "background"],
  ["次要文字 /65", "muted-foreground/65", "card"],
  ["次要文字 /75", "muted-foreground/75", "background"],
  ["次要文字 /75", "muted-foreground/75", "card"],
  // 2026-11-09 补（QQA）：全仓实际用到的次级文字透明度档
  // （scripts/audit-muted-text.mjs 扫出来的）
  ["次要文字 /90", "muted-foreground/90", "background"],
  ["次要文字 /90", "muted-foreground/90", "card"],
  ["次要文字 /95", "muted-foreground/95", "background"],
  ["次要文字 /95", "muted-foreground/95", "card"],
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
  // 焦点环用的半透明品牌色：环画在按钮外面的卡片上，
  // 能不能看清看的是「环色 vs 相邻底色」，不是「环色 vs 按钮底色」。
  ["焦点环 /30", "primary/30", "background"],
  ["焦点环 /30", "primary/30", "card"],
  ["焦点环 /40", "primary/40", "background"],
  ["焦点环 /40", "primary/40", "card"],
  // 删除按钮的焦点环用的是半透明危险色
  ["焦点环 危险色 /50", "destructive/50", "background"],
  ["焦点环 危险色 /50", "destructive/50", "card"],
  // 反白字压在语义色底上（「已复制」角标那一类）
  ["反白字压成功色", "primary-foreground", "success", "success"],
];

/**
 * 底不是卡片 / 页面底的情形 —— 第四项显式指定基底
 *
 * 例：AI 聊天的用户气泡是实心 --primary，复制按钮在自己的浅色底上，
 * 图标既不压卡片也不压页面底，压的是「按钮底」—— 按钮底又是叠在气泡上的。
 * 这种组合没法用 card / background 代，所以基底单列。
 */
const COMBOS_CUSTOM_BASE = [
  ["用户气泡复制按钮图标", "primary-foreground/70", "primary-foreground/15", "primary"],
  ["用户气泡复制按钮图标(实心)", "primary-foreground", "primary-foreground/15", "primary"],
  ["用户气泡复制按钮底 vs 气泡", "primary-foreground/15", "primary", "primary"],
  ["用户气泡白字", "primary-foreground", "primary", "primary"],
  // 选中底纹（/15）与悬停底纹（/10）之间的差距 ——
  // 两者都压在卡片上，要比的是「底纹与底纹」，不是「底纹与卡片」
  ["选中底纹 /15 vs 悬停底纹 /10", "primary/15", "primary/10", "card"],
  ["选中底纹 /15 vs 卡片", "primary/15", "card", "card"],
  ["悬停底纹 /10 vs 卡片", "primary/10", "card", "card"],
];

const AA = 4.5;
const AAA = 7;
const AA_LARGE = 3;

function computeTheme(colors, label) {
  const rows = [];

  for (const [name, fgSpec, bgSpec, baseSpec] of [...COMBOS, ...COMBOS_CUSTOM_BASE]) {
    const fg = tokenColor(colors, fgSpec);
    const bg = tokenColor(colors, bgSpec);
    if (!fg || !bg) continue;

    const perBase = {};
    // 显式指定基底时只看那一个底，否则 card 与 background 都算、取更差者
    const bases = baseSpec ? [baseSpec] : BASE_BACKGROUNDS;
    for (const base of bases) {
      const baseColor = colors.get(base);
      if (!baseColor) continue;

      // 底：半透明档先叠在基底上，再叠回基底
      const bgLayered = composite(bg.rgb, baseColor, bg.alpha);
      // 字：半透明档叠在合成后的底上
      const fgLayered = composite(fg.rgb, bgLayered, fg.alpha);

      perBase[base] = contrast(fgLayered, bgLayered);
    }

    const values = Object.values(perBase);
    if (!values.length) continue;
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
    const custom = card === undefined && bg === undefined ? Object.entries(r.perBase)[0] : null;
    const verdict = r.aaa ? "AAA" : r.aa ? "AA" : r.large ? "仅大字" : "不过线";
    console.log(
      `${pad(r.name, 22)}${pad(r.fg, 26)}${pad(r.bg + (custom ? ` @${custom[0]}` : ""), 22)}` +
        `${pad(custom ? custom[1].toFixed(2) : card !== undefined ? card.toFixed(2) : "-", 9)}` +
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

/**
 * 两套主题的调色板（token 名 → sRGB 三元组）
 *
 * 给「具体到某一处写法」的守卫用 —— 比如 CSS 里手写的
 * `color: hsl(var(--muted-foreground) / 0.7)`，它要按同一套口径算对比度，
 * 不能自己再实现一遍 HSL 转换。
 */
export function buildPalettes() {
  const dark = buildPalette(darkRaw);
  for (const [name, rgb] of buildPalette(lightRaw)) {
    if (!dark.has(name)) dark.set(name, rgb);
  }
  return { light: buildPalette(lightRaw), dark };
}

// 只有被当命令行跑的时候才打印；被 import 时安静退出
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json");
  // --json 是输出格式开关，不是主题开关：单独给 --json 时不能把两套主题都关掉，
  // 否则打出来的是空矩阵 []，看着像「没有过线的组合」。
  const wantLight = args.length === 0 || args.includes("--light") || wantJson;
  const wantDark = args.length === 0 || args.includes("--dark") || wantJson;

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
