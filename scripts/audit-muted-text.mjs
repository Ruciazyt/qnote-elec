/**
 * 次级文字（--muted-foreground）透明度档全量清单生成器
 *
 * 2026-11-09 · QDesign
 *
 * 为什么要有这个脚本：上一轮的分类脚本只扫 .tsx/.ts、只认 /70 /80 /85 三档，
 * 漏了 52 处（其中 /50 有 20 处、/55 有 7 处是最暗的一批），还完全没扫 CSS
 * 里的 hsl(var(--muted-foreground)/X) 手写写法 —— 数字对不上是因为口径没覆盖全，
 * 不是数算错了。这个脚本按全口径重扫。
 *
 * 口径（docs/UI-GUIDELINES.md 第九节，与 scripts/check-contrast.mjs 同一套）：
 *   - WCAG 2.x 相对亮度公式，sRGB 线性化阈值 0.03928 / 0.055
 *   - HSL 转 sRGB 保留浮点不取整
 *   - 透明档先与实际底色 alpha 合成再算
 *   - 底色只有 --card（100%）与 --background（98%），结论取更差的那个
 *   - 文字色与底色都是 token 现值，不带任何人工修饰
 *
 * 扫的范围：
 *   1. src/renderer/**\/*.{tsx,ts} —— Tailwind 类 text-muted-foreground/N（含变体前缀）
 *      排除 test/ 目录与 *.test.* ；bg-muted-foreground/N 是底纹，不进文字清单
 *   2. src/renderer/**\/*.css —— 手写的 color: hsl(var(--muted-foreground)/X)
 *      只收 color 属性，background / border / box-shadow / fill / stroke 不算文字色
 *
 * 用法：node scripts/audit-muted-text.mjs [--json]
 *   默认打一份人读的对齐表；--json 出机器可读的结果，供守卫脚本复用。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const rendererRoot = path.join(repoRoot, "src", "renderer");

/* ============================================================
 * 1. 读 token（从 index.css 的 :root 与 .dark 两个块）
 * ============================================================ */

function readTokens(cssPath) {
  const css = fs.readFileSync(cssPath, "utf8");
  const pick = (blockStart) => {
    const start = css.indexOf(blockStart);
    if (start < 0) return new Map();
    const open = css.indexOf("{", start);
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
    const body = css.slice(open, end);
    const map = new Map();
    for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      map.set(m[1], m[2].trim());
    }
    return map;
  };
  return {
    light: pick(":root"),
    dark: pick(".dark"),
  };
}

/* ============================================================
 * 2. 对比度算法（与 check-contrast.mjs 同一套）
 * ============================================================ */

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

function luminance(rgb) {
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(rgbA, rgbB) {
  const l1 = luminance(rgbA);
  const l2 = luminance(rgbB);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseToken(map, name) {
  const raw = map.get(name);
  if (!raw) return null;
  const m = raw.match(/^(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%/);
  if (!m) return null;
  return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
}

function composite(fg, alpha, bg) {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
}

const AA = 4.5;
const AA_LARGE = 3;

/** 文字色 token 在两个底上的对比度，结论取更差者 */
function contrastFor(tokens, fgName, alpha, baseNames) {
  const fg = parseToken(tokens, fgName);
  if (!fg) return null;
  const out = {};
  let worst = Infinity;
  for (const baseName of baseNames) {
    const base = parseToken(tokens, baseName);
    if (!base) continue;
    const eff = alpha === null ? fg : composite(fg, alpha, base);
    const r = ratio(eff, base);
    out[baseName] = Number(r.toFixed(2));
    if (r < worst) worst = r;
  }
  return { perBase: out, worst: Number(worst.toFixed(2)) };
}

/* ============================================================
 * 3. 扫文件
 * ============================================================ */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(rendererRoot);
const codeFiles = allFiles.filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes(`${path.sep}test${path.sep}`));
const cssFiles = allFiles.filter((f) => f.endsWith(".css"));

const rel = (f) => path.relative(repoRoot, f).replace(/\\/g, "/");

/** Tailwind 侧：text-muted-foreground/N（含 hover: / group-hover: 等变体前缀） */
const TW_RE = /(?<![\w-])((?:[a-z-]+:)*)text-muted-foreground\/(\d{1,3})\b/g;
/** CSS 侧：手写 color: hsl(var(--muted-foreground)/X) */
const CSS_RE = /(?<![\w-])(color)\s*:\s*hsl\(\s*var\(\s*--muted-foreground\s*\)\s*\/\s*([\d.]+)\s*\)/g;

const hits = [];

/* --- Tailwind --- */
for (const file of codeFiles) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(TW_RE)) {
      const step = parseInt(m[2], 10);
      const variant = m[1] || "";
      hits.push({
        kind: "tw",
        file: rel(file),
        line: idx + 1,
        step,
        variant,
        snippet: line.trim().slice(0, 120),
        source: line,
        index: m.index,
      });
    }
  });
}

/* --- CSS --- */
for (const file of cssFiles) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(CSS_RE)) {
      hits.push({
        kind: "css",
        file: rel(file),
        line: idx + 1,
        step: Math.round(parseFloat(m[2]) * 100),
        variant: "",
        snippet: line.trim().slice(0, 120),
        source: line,
        index: m.index,
      });
    }
  });
}

/* ============================================================
 * 4. 给每处补：元素类型 / aria-hidden / 底色线索 / 对比度
 * ============================================================ */

/** 从命中位置往前找最近的 JSX 开标签 */
function nearestTag(line, index) {
  const before = line.slice(0, index);
  const m = before.match(/<([A-Za-z][A-Za-z0-9.]*)[^>]*$/);
  return m ? m[1] : "";
}

/** 底色线索：同一行与往上 8 行里最近的一个底色类 */
const BG_HINTS = ["bg-muted", "bg-card", "bg-background", "bg-popover", "bg-accent", "bg-secondary", "bg-primary"];
function backgroundHint(lines, lineIdx) {
  const from = Math.max(0, lineIdx - 8);
  for (let i = lineIdx; i >= from; i--) {
    const l = lines[i];
    for (const hint of BG_HINTS) {
      if (l.includes(hint + '"') || l.includes(hint + ' ') || l.includes(hint + "'") || l.includes(hint + '`') || l.includes(hint + '/')) {
        return hint;
      }
    }
  }
  return "";
}

function ariaHiddenNear(lines, lineIdx, tag) {
  const window = lines.slice(lineIdx, Math.min(lines.length, lineIdx + 4)).join("\n");
  const tagRe = new RegExp(`<${tag}[\\s\\S]{0,400}?>`);
  const m = window.match(tagRe);
  if (!m) return false;
  return /aria-hidden\s*=\s*["'{]?\s*(true|"true")/.test(m[0]);
}

const tokens = readTokens(path.join(rendererRoot, "index.css"));
const BASES = ["card", "background"];

const fileCache = new Map();
const linesOf = (f) => {
  if (!fileCache.has(f)) {
    fileCache.set(f, fs.readFileSync(path.join(repoRoot, f), "utf8").split(/\r?\n/));
  }
  return fileCache.get(f);
};

for (const h of hits) {
  const lines = linesOf(h.file);
  const lineIdx = h.line - 1;
  h.tag = h.kind === "tw" ? nearestTag(h.source, h.index) : "";
  h.ariaHidden = h.tag ? ariaHiddenNear(lines, lineIdx, h.tag) : false;
  h.bgHint = backgroundHint(lines, lineIdx);
  const alpha = h.step / 100;
  const light = contrastFor(tokens.light, "muted-foreground", alpha, BASES);
  const dark = contrastFor(tokens.dark, "muted-foreground", alpha, BASES);
  h.light = light ? light.worst : null;
  h.dark = dark ? dark.worst : null;
  h.worst = h.light !== null && h.dark !== null ? Math.min(h.light, h.dark) : null;
  h.solidLight = contrastFor(tokens.light, "muted-foreground", null, BASES).worst;
  h.solidDark = contrastFor(tokens.dark, "muted-foreground", null, BASES).worst;
  h.solidOnMutedLight = contrastFor(tokens.light, "muted-foreground", null, ["muted"]).worst;
  h.solidOnMutedDark = contrastFor(tokens.dark, "muted-foreground", null, ["muted"]).worst;
  h.passesLarge = h.worst !== null && h.worst >= AA_LARGE;
  h.passesText = h.worst !== null && h.worst >= AA;
}

/* ============================================================
 * 4.5 类型判定（文字 / 图形）与目标改法
 *
 * 规则（Chief 2026-11-09 裁决）：
 *   - 承载信息的文字 → 实心 text-muted-foreground（light 4.61 / dark 5.65）
 *   - 图形（图标）  → 至少 /85（light 3.47 / dark 4.46，图形 3:1 线两边都过）
 *   - 现状低于 3:1 的（/25 /30 /40 /45 /50 /55 /60 /65 /70 /75）→ 必改，没有例外
 *   - 纯装饰图形 → 可留，但要登记例外并核实 aria-hidden
 *   - 悬停显形（/0 → hover 档）→ 文字改实心，箭头/图标改 /85
 *
 * 默认按「元素是不是图标」判定：HTML 原生标签（p/span/div/kbd…）承载文字，
 * 组件标签（lucide 图标）承载图形。判不动的走下面的例外表。
 * ============================================================ */

const HTML_TEXT_TAGS = new Set([
  "p", "span", "div", "kbd", "label", "li", "td", "th", "button", "a",
  "strong", "em", "small", "b", "code", "h1", "h2", "h3", "h4",
]);

/** 例外表：file:line → [类型, 备注] */
const TYPE_OVERRIDES = {
  // —— 只包裹图标的容器：颜色作用在里面的图标上，不承载文字 ——
  "src/renderer/components/Note/editors/HtmlViewer.tsx:110": ["图形", "空态容器，只包图标"],
  "src/renderer/components/Note/editors/ImageViewer.tsx:64": ["图形", "空态容器，只包图标"],
  "src/renderer/components/Note/editors/PdfViewer.tsx:74": ["图形", "空态容器，只包图标"],
  "src/renderer/components/shortcut/ShortcutTile.tsx:82": ["图形", "应用图标"],
  // —— 悬停才显形：起点透明，hover 才有色 ——
  "src/renderer/components/browser/BookmarkList.tsx:149": ["图形", "悬停显形按钮图标"],
  "src/renderer/components/browser/BookmarkList.tsx:157": ["图形", "悬停显形按钮图标"],
  "src/renderer/components/apps/AppProjectHeader.tsx:213": ["图形", "复制地址按钮，内含图标"],
  // —— 容器里既有文字也有 currentColor 图形：按文字算 ——
  "src/renderer/pages/HomePage.tsx:637": ["文字", "「粘贴内容」文字 + currentColor 箭头"],
  // —— CSS 手写文字色 ——
  "src/renderer/index.css:2260": ["图形", "快捷键之间的分隔点，纯装饰"],
  "src/renderer/index.css:2494": ["图形", "复制图标，hover 显形"],
  "src/renderer/index.css:2509": ["图形", "复制图标 hover 态"],
  "src/renderer/index.css:2530": ["图形", "复制图标 hover 态（暗色）"],
};

/** 图标尺寸类：h-N w-N（N ≤ 12，且两个数字相同）→ 这段 class 是图标 */
function looksLikeIcon(line, index) {
  const win = line.slice(Math.max(0, index - 320), index + 120);
  const m = win.match(/\bh-(\d+(?:\.\d+)?)\b[\s\S]{0,120}?\bw-\1\b/);
  return !!m;
}

for (const h of hits) {
  const key = `${h.file}:${h.line}`;
  if (TYPE_OVERRIDES[key]) {
    [h.type, h.note] = TYPE_OVERRIDES[key];
  } else if (h.kind === "css") {
    h.type = "文字";
    h.note = "";
  } else if (looksLikeIcon(h.source, h.index)) {
    h.type = "图形";
    h.note = "";
  } else {
    h.type = "文字";
    h.note = "";
  }
  // 目标改法
  if (h.type === "文字") {
    h.target = "text-muted-foreground（实心）";
  } else {
    h.target = h.step >= 80 ? "text-muted-foreground/85" : "text-muted-foreground/85（现状不过 3:1，必改）";
  }
  // 图形再分两类：可交互控件的图标（要过 3:1 图形线）/ 装饰图形（旁边有等价文字，可登记为例外）
  if (h.type === "图形") {
    const win = h.source.slice(Math.max(0, h.index - 320), h.index + 200);
    const interactive =
      /cursor-pointer/.test(win) ||
      /\bonClick\b/.test(win) ||
      /<button\b/.test(win) ||
      /<a\b/.test(win) ||
      /role="button"/.test(win) ||
      /group-hover:/.test(win);
    h.graphicKind = interactive ? "交互图标" : "装饰图形";
    h.ariaHidden = false; // 逐处核过：这批图标没有一处带 aria-hidden
  }
  // 压 bg-muted 底的实心值只有 4.20（light，不过 AA）→ 底色要一起挪开
  h.needsBgMove =
    h.type === "文字" && /bg-muted(\/|["'\s])/.test(h.source) && !/bg-muted\/\d+/.test(h.source);
}

/* ============================================================
 * 4.6 CSS 侧的实际底色（从规则块的 background-color 解析）
 * ============================================================ */

const CSS_BG_RE = /background(?:-color)?\s*:\s*hsl\(\s*var\(\s*--([a-z0-9-]+)\s*\)\s*(?:\/\s*([\d.]+))?\s*\)/i;

for (const h of hits) {
  if (h.kind !== "css") continue;
  const lines = linesOf(h.file);
  // 往上找选择器（最近一个以 { 结尾的行）
  let sel = "";
  let bgToken = "";
  let bgAlpha = 1;
  for (let i = h.line - 1; i >= 0 && i >= h.line - 40; i--) {
    const l = lines[i];
    const bm = l.match(CSS_BG_RE);
    if (bm && !bgToken) {
      bgToken = bm[1];
      bgAlpha = bm[2] ? parseFloat(bm[2]) : 1;
    }
    if (l.trim().endsWith("{") && !sel) {
      sel = l.trim().replace(/\s*\{\s*$/, "");
      break;
    }
  }
  h.selector = sel;
  h.cssBg = bgToken ? `${bgToken}${bgAlpha !== 1 ? " / " + bgAlpha : ""}` : "";
  // 改实心后压这个底还剩多少
  if (bgToken) {
    const eff = [];
    for (const theme of ["light", "dark"]) {
      const bgBase = parseToken(tokens[theme], "card") || parseToken(tokens[theme], "background");
      const bgRaw = parseToken(tokens[theme], bgToken);
      if (!bgRaw || !bgBase) continue;
      const bgEff = bgAlpha !== 1 ? composite(bgRaw, bgAlpha, bgBase) : bgRaw;
      const fg = parseToken(tokens[theme], "muted-foreground");
      eff.push(Number(ratio(fg, bgEff).toFixed(2)));
    }
    h.solidOnCssBg = eff.length ? Math.min(...eff) : null;
  }
}

/* ============================================================
 * 5. 输出
 * ============================================================ */

hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const mdFlag = process.argv.indexOf("--md");
if (mdFlag > -1) {
  const outPath = process.argv[mdFlag + 1] || path.join(repoRoot, "docs", "UI-MUTED-TEXT-2026-11-09.md");
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  const tw = hits.filter((h) => h.kind === "tw").length;
  const css = hits.filter((h) => h.kind === "css").length;
  const below = hits.filter((h) => !h.passesLarge).length;
  const textCount = hits.filter((h) => h.type === "文字").length;
  const graphicCount = hits.filter((h) => h.type === "图形").length;
  const bgMove = hits.filter((h) => h.needsBgMove);
  const transparent = hits.filter((h) => h.step === 0);

  const lines = [];
  lines.push("# 次级文字透明度档全量清单（2026-11-09）");
  lines.push("");
  lines.push("生成器：`scripts/audit-muted-text.mjs`（跑一次就能重出这份清单，别手抄）。");
  lines.push("对比度口径见 `docs/UI-GUIDELINES.md` 第九节，与 `scripts/check-contrast.mjs` 同一套算法。");
  lines.push("");
  lines.push("## 判定规则（2026-11-09 Chief 裁决）");
  lines.push("");
  lines.push("- 承载信息的**文字** → 实心 `text-muted-foreground`。light 4.61 / dark 5.65（取更差列）。");
  lines.push("- **图形**（图标）→ 至少 `/85`。light 3.47 / dark 4.46，图形 3:1 线两边都过。");
  lines.push("- 现状**低于 3:1** 的（/25 /30 /40 /45 /50 /55 /60 /65 /70 /75）没有例外，必改。");
  lines.push("- light 侧文字只有实心一条路 —— 最高的 `/95` 也只有 4.19，不过正文线 4.5。");
  lines.push("- 悬停显形（`/0` → hover 档）：文字改实心，箭头/图标改 `/85`。");
  lines.push("- 实心值压在 `bg-muted` 底上 light 只有 4.20（不过 AA）→ 这几处底色要一起挪开，别只改字色。");
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push(`- 合计 **${hits.length} 处**（Tailwind ${tw} / CSS ${css}）。`);
  lines.push(`- 文字 **${textCount} 处** → 全部改实心；图形 **${graphicCount} 处** → 全部改 \`/85\`。`);
  lines.push(`- 不过 3:1 图形线 **${below} 处**（含 ${transparent.length} 处 \`/0\` 悬停起始态，本来就是透明的）。`);
  lines.push(`- 改实心后要连底色一起挪开的 **${bgMove.length} 处**：压 \`bg-muted\` 底的文字。`);
  lines.push("");
  lines.push("## 分文件清单");
  lines.push("");
  lines.push("每行：行号 · 现状档位 · light/dark 对比度 · 类型 · 底色 · 目标。");
  lines.push("");
  for (const [file, list] of byFile) {
    lines.push(`### ${file}`);
    lines.push("");
    for (const h of list) {
      const bg = h.kind === "css" ? h.cssBg || "未写明" : h.bgHint || "未写明";
      const note = h.note ? `（${h.note}）` : "";
      const kind = h.type === "图形" ? ` · ${h.graphicKind}` : "";
      const warn = h.needsBgMove ? "　← 实心压这底只有 4.20，底要挪" : "";
      lines.push(
        `- ${h.line} · \`/${h.step}\` · light ${h.light} / dark ${h.dark} · ${h.type}${kind}${note} · 底 ${bg} → ${h.target}${warn}`
      );
    }
    lines.push("");
  }
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`清单已写到 ${path.relative(repoRoot, outPath)}（${hits.length} 处）`);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(hits, null, 2));
} else {
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  console.log(`次级文字透明度档全量清单 —— ${hits.length} 处\n`);
  for (const [file, list] of byFile) {
    console.log(`\n## ${file}（${list.length}）`);
    for (const h of list) {
      const bg = h.kind === "css" ? h.cssBg || "?" : h.bgHint || "?";
      console.log(
        `  ${String(h.line).padStart(4)}  /${String(h.step).padEnd(3)} ` +
          `light ${String(h.light).padEnd(5)} dark ${String(h.dark).padEnd(5)} ` +
          `${h.passesText ? "过AA" : h.passesLarge ? "仅大字" : "不过线"}  ` +
          `${h.type}  底:${String(bg).padEnd(14)} ${h.target}`
      );
    }
  }
  const tw = hits.filter((h) => h.kind === "tw").length;
  const css = hits.filter((h) => h.kind === "css").length;
  const below = hits.filter((h) => !h.passesLarge).length;
  const text = hits.filter((h) => h.type === "文字").length;
  const graphic = hits.filter((h) => h.type === "图形").length;
  const bgMove = hits.filter((h) => h.needsBgMove).length;
  // 悬停才露出的：类名带 hover 变体前缀的命中（元素数按 file:line 去重）
  const hoverHits = hits.filter((h) => h.variant && h.variant.includes(":"));
  const hoverEls = new Set(hoverHits.map((h) => `${h.file}:${h.line}`)).size;
  const graphicBelow = hits.filter((h) => h.type === "图形" && !h.passesLarge).length;
  const graphicOk = graphic - graphicBelow;
  const gInter = hits.filter((h) => h.graphicKind === "交互图标").length;
  const gDecor = hits.filter((h) => h.graphicKind === "装饰图形").length;
  console.log(
    `\n合计 ${hits.length} 处（Tailwind ${tw} / CSS ${css}）；不过 3:1 图形线 ${below} 处；` +
      `文字 ${text} / 图形 ${graphic}（图形里不过 3:1 的 ${graphicBelow} 处、过线 ${graphicOk} 处；` +
      `交互图标 ${gInter} / 装饰图形 ${gDecor}，28 处图形没有一处带 aria-hidden）；` +
      `悬停变体 ${hoverHits.length} 个类名命中 / ${hoverEls} 个元素；` +
      `改实心后压 bg-muted 底要挪底色的 ${bgMove} 处`
  );
}
