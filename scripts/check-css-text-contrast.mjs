/**
 * CSS 文字色对比度扫描
 *
 * 2026-11-09 · QQA
 *
 * 为什么要有这个脚本：
 *   UI 守卫（src/renderer/test/ui-guards.ts）扫的是 TSX 里的 Tailwind 类名，
 *   扫不到 CSS 里手写的 `color: hsl(var(--muted-foreground) / 0.7)`。
 *   这类写法同样落在界面上、同样要过对比度线，但此前没有任何机制在看它们。
 *   `scripts/audit-muted-text.mjs` 只认 --muted-foreground 一个 token，
 *   foreground / primary / success / destructive 这些同样在用。
 *
 * 判定口径：
 *   - 文字色 = `color` 与 `-webkit-text-fill-color` 两个属性。
 *     background / border / box-shadow / fill / stroke 是底纹与图形，不判
 *     （与 scripts/audit-muted-text.mjs 的取法一致）。
 *   - 对比度算法直接用 scripts/check-contrast.mjs 的那套（同一个出处，不重写一遍）。
 *   - 底色：规则自己写了纯色 background 就用它，否则用 --card 与 --background 取更差者。
 *   - 阈值：文字 4.5:1（AA 正文线）；3:1 是图形线，CSS 的 color 属性先按文字算。
 *
 * 用法：
 *   node scripts/check-css-text-contrast.mjs            # 人读的对齐表
 *   node scripts/check-css-text-contrast.mjs --json     # 机器可读
 *
 * ⚠ 这个文件不要加 shebang（`#!/usr/bin/env node`）——
 *   「shebang + CRLF」vitest 解析不了，import 它的守卫测试会整个套件加载失败。
 *   理由与 scripts/check-contrast.mjs 头部那段一样。
 *
 * 无第三方依赖，只用 Node 内置模块。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPalettes, tokenColor, composite, contrast } from "./check-contrast.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const rendererRoot = path.join(repoRoot, "src", "renderer");

/** 文字色属性 —— 只有这两个算文字 */
const TEXT_PROPS = new Set(["color", "-webkit-text-fill-color"]);

/** 整个值就是一个 hsl(var(--token) / alpha) */
const HSL_VAR_RE = /^\s*hsl\(\s*var\(\s*--([a-z0-9-]+)\s*\)\s*(?:\/\s*([\d.]+)\s*)?\)\s*$/i;

/** 值里所有的 hsl(var(--token) / alpha) —— 渐变底要用（每个色标都是一种底） */
const HSL_ANY_RE = /hsl\(\s*var\(\s*--([a-z0-9-]+)\s*\)\s*(?:\/\s*([\d.]+)\s*)?\)/gi;

/* ============================================================
 * 1. 极简 CSS 解析
 *
 * 不引第三方库：只认「选择器 { 声明; 声明 }」这一层，
 * 嵌套的 @media / @supports 当分组处理（里面的规则照样收），
 * @keyframes 里的关键帧不是元素样式，整块跳过。
 * ============================================================ */

/**
 * @returns {{selector: string, context: string[], decls: {prop: string, value: string, line: number}[]}[]}
 */
export function parseCssRules(text) {
  const rules = [];
  const stack = [];
  let buf = "";
  let bufStart = 1;
  let line = 1;

  const commit = () => {
    const t = buf.trim();
    const top = stack[stack.length - 1];
    buf = "";
    if (!t || !top || top.kind !== "rule") return;
    const idx = t.indexOf(":");
    if (idx <= 0) return;
    top.decls.push({
      prop: t.slice(0, idx).trim().toLowerCase(),
      value: t.slice(idx + 1).trim(),
      line: bufStart,
    });
  };

  for (const raw of text.split(/\r?\n/)) {
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      if (ch === "{") {
        const sel = buf.trim();
        buf = "";
        if (/^@keyframes/i.test(sel)) {
          stack.push({ kind: "keyframes", selector: sel, context: [], decls: [] });
        } else if (sel.startsWith("@")) {
          stack.push({ kind: "at", selector: sel, context: [], decls: [] });
        } else {
          stack.push({
            kind: "rule",
            selector: sel,
            context: stack.filter((s) => s.kind === "at").map((s) => s.selector),
            decls: [],
          });
        }
        bufStart = line;
        continue;
      }

      if (ch === "}") {
        commit();
        const ctx = stack.pop();
        if (ctx && ctx.kind === "rule") rules.push(ctx);
        buf = "";
        bufStart = line;
        continue;
      }

      if (ch === ";") {
        commit();
        bufStart = line;
        continue;
      }

      if (!buf.trim() && ch.trim()) bufStart = line;
      buf += ch;
    }
    bufStart = line;
    line++;
  }

  return rules;
}

/* ============================================================
 * 2. 算对比度
 * ============================================================ */

const BASE_NAMES = ["card", "background"];

/**
 * 签名：文件 › 去掉注释的选择器 › token@透明度
 *
 * 不含行号 —— CSS 改一行，后面所有行号都漂，签名跟着漂基线就废了。
 */
export function hitSignature(file, selector, token, alpha) {
  const sel = selector
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${file} › ${sel} › ${token}@${alpha}`;
}

/**
 * 一个文字色写法在两套主题下的对比度
 *
 * @param token  前景 token 名
 * @param alpha  CSS 里写的透明度档（0..1）
 * @param ownBases 规则自己声明的底色（没有就空数组）
 * @param themes  要算哪几套主题（`.dark` 选择器只在暗色下成立）
 */
function measure(token, alpha, ownBases, themes, palettes) {
  const perTheme = {};

  for (const theme of themes) {
    const colors = palettes[theme];
    // ⚠ 这里直接取 token 的原色，透明度用 CSS 里写的档位 ——
    //   tokenColor() 认的是 "primary/10" 这种写法，CSS 里是分开的
    //   「token + 单独写的 alpha」，两者不能混，否则透明度会被当成 1。
    const fgRgb = colors.get(token);
    if (!fgRgb) {
      perTheme[theme] = null;
      continue;
    }

    const bases = [];
    for (const ob of ownBases) {
      const bgRgb = colors.get(ob.token);
      const card = colors.get("card") ?? colors.get("background");
      if (!bgRgb || !card) continue;
      // 规则自己的底先叠在卡片上
      bases.push({
        name: `自有底 ${ob.token}${ob.alpha !== 1 ? "/" + Math.round(ob.alpha * 100) : ""}`,
        color: composite(bgRgb, card, ob.alpha),
      });
    }
    if (!bases.length) {
      for (const name of BASE_NAMES) {
        const c = colors.get(name);
        if (c) bases.push({ name, color: c });
      }
    }
    if (!bases.length) {
      perTheme[theme] = null;
      continue;
    }

    const perBase = {};
    for (const b of bases) {
      perBase[b.name] = contrast(composite(fgRgb, b.color, alpha), b.color);
    }
    perTheme[theme] = { perBase, worst: Math.min(...Object.values(perBase)) };
  }

  const values = [perTheme.light?.worst, perTheme.dark?.worst].filter((v) => v !== undefined);
  // token 不在这套主题里（便签自己的 --sticky-ink 等）→ 不判，别当成 0
  if (!values.length) {
    return { perTheme, worst: null, aa: false, large: false, unknown: true };
  }
  const worst = Math.min(...values);

  return { perTheme, worst, aa: worst >= 4.5, large: worst >= 3, unknown: false };
}

/* ============================================================
 * 3. 扫描
 * ============================================================ */

/**
 * 扫一段 CSS，返回所有文字色写法
 *
 * @param text CSS 源码
 * @param opts.file   报告里显示的文件名
 * @param opts.palettes 两套主题的调色板
 */
export function scanCssTextColors(text, { file = "<memory>", palettes = buildPalettes() } = {}) {
  const rules = parseCssRules(text);
  const hits = [];

  for (const rule of rules) {
    // 规则自带的底色：纯色 background 与渐变里的每个色标都算一种底（取更差者）。
    // 底是图片（url(...)）时算不出来，当没有自有底。
    const ownBases = [];
    for (const d of rule.decls) {
      if (d.prop !== "background" && d.prop !== "background-color") continue;
      if (!/url\(/i.test(d.value)) {
        for (const m of d.value.matchAll(HSL_ANY_RE)) {
          ownBases.push({
            token: m[1],
            alpha: m[2] !== undefined ? Number(m[2]) : 1,
          });
        }
      }
      break;
    }

    for (const d of rule.decls) {
      if (!TEXT_PROPS.has(d.prop)) continue;
      const m = HSL_VAR_RE.exec(d.value);
      if (!m) continue;
      const token = m[1];
      const alpha = m[2] !== undefined ? Number(m[2]) : 1;
      // `.dark` 开头的选择器只在暗色主题下成立，只算暗色那一套；
      // 普通选择器在两套主题下都成立，取更差的那个。
      const themes = /\.dark\b/.test(rule.selector) ? ["dark"] : ["light", "dark"];
      const known = themes.some((t) => palettes[t].has(token));
      hits.push({
        file,
        line: d.line,
        selector: rule.selector,
        signature: hitSignature(file, rule.selector, token, alpha),
        context: rule.context,
        prop: d.prop,
        token,
        alpha,
        ownBases,
        // token 不在主题里（便签那套自己的 --sticky-ink 等）→ 不判，另行登记
        skipped: !known,
        ...measure(token, alpha, ownBases, themes, palettes),
      });
    }
  }

  return hits;
}

/** 仓库里 src/renderer 下的全部 CSS（排除 node_modules） */
export function cssFilesInRepo(root = rendererRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** 扫整个仓库的 CSS */
export function scanRepoCss({ root = rendererRoot, palettes = buildPalettes() } = {}) {
  const hits = [];
  for (const abs of cssFilesInRepo(root)) {
    const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
    const text = fs.readFileSync(abs, "utf8");
    hits.push(...scanCssTextColors(text, { file: rel, palettes }));
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/* ============================================================
 * 4. 入口
 * ============================================================ */

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const all = scanRepoCss();
  const hits = all.filter((h) => !h.skipped);
  const skipped = all.filter((h) => h.skipped);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(all, null, 2));
  } else {
    console.log(`CSS 文字色扫描 —— ${hits.length} 处（另有 ${skipped.length} 处 token 不在主题里，不判）`);
    console.log(
      "口径：WCAG 2.x；底取规则自有底（纯色 background / 渐变每个色标）或 --card/--background 更差者；文字线 4.5:1"
    );
    for (const h of hits) {
      const light = h.perTheme.light ? h.perTheme.light.worst.toFixed(2) : "-";
      const dark = h.perTheme.dark ? h.perTheme.dark.worst.toFixed(2) : "-";
      const verdict = h.aa ? "过AA" : h.large ? "仅大字" : "不过线";
      console.log(
        `  ${h.file}:${h.line}  ${h.prop}: hsl(var(--${h.token})${
          h.alpha !== 1 ? ` / ${h.alpha}` : ""
        })  light ${light} / dark ${dark}  ${verdict}  ← ${h.selector.replace(/\s+/g, " ").slice(0, 60)}`
      );
    }
    for (const h of skipped) {
      console.log(`  ${h.file}:${h.line}  ${h.prop}: hsl(var(--${h.token}))  ← token 不在主题里，跳过`);
    }
    const bad = hits.filter((h) => !h.aa);
    console.log(`\n不过 AA（4.5）：${bad.length} 处 / 共 ${hits.length} 处`);
  }
}
