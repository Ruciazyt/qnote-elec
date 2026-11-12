/**
 * 灵动岛配色的对比度自检
 *
 * 仓库的 CSS 文字对比度守卫（scripts/check-css-text-contrast.mjs）只认
 * index.css 里的主题 token，岛的 --island-* 是私有 token，它会跳过 ——
 * 和 --sticky-ink 一样。于是岛的配色要自己算一遍，用同一套 WCAG 公式。
 *
 * 两头都能用：
 *   命令行：node scripts/build/check-island-contrast.mjs
 *   用例：  src/renderer/test/island-contrast.test.ts（导入 buildIslandMatrix）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cssPath = path.join(repoRoot, "src/renderer/components/island/island.css");

/**
 * 要检查的组合：前景 token 压在背景 token 上
 *
 * min 是这一组要过的线：正文 4.5:1，图形（圆点、图标、光标）3:1。
 */
export const ISLAND_PAIRS = [
  // 正文
  { fg: "island-text", bg: "island-surface", min: 4.5 },
  { fg: "island-text", bg: "island-surface-inner", min: 4.5 },
  { fg: "island-text-muted", bg: "island-surface", min: 4.5 },
  { fg: "island-text-muted", bg: "island-surface-inner", min: 4.5 },
  // 品牌色当文字：激活项、有内容的圆点
  { fg: "island-primary", bg: "island-surface", min: 4.5 },
  { fg: "island-primary-strong", bg: "island-surface", min: 4.5 },
  { fg: "island-primary-strong", bg: "island-surface-inner", min: 4.5 },
  // 品牌底色上的字（发送按钮、勾选框里的对勾）—— 图形线
  { fg: "island-primary-foreground", bg: "island-primary", min: 3 },
  // 语义色：错误提示是正文，圆点与状态灯是图形
  { fg: "island-destructive-text", bg: "island-surface", min: 4.5 },
  { fg: "island-destructive-text", bg: "island-surface-inner", min: 4.5 },
  { fg: "island-destructive-foreground", bg: "island-destructive", min: 3 },
  { fg: "island-success", bg: "island-surface", min: 3 },
  { fg: "island-warning", bg: "island-surface", min: 3 },
];

/** 正文线 */
export const AA = 4.5;
/** 图形线 */
export const AA_LARGE = 3;

/** 取一个 CSS 块里的 --token: 值 */
function tokensInBlock(css, blockStart) {
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
  const body = css.slice(open + 1, end);
  const out = new Map();
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** HSL → sRGB（0..1） */
function hslToRgb(h, s, l) {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = s / 100;
  const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh * 6) % 2) - 1));
  const m = ll - c / 2;
  let rgb;
  if (hh < 1 / 6) rgb = [c, x, 0];
  else if (hh < 2 / 6) rgb = [x, c, 0];
  else if (hh < 3 / 6) rgb = [0, c, x];
  else if (hh < 4 / 6) rgb = [0, x, c];
  else if (hh < 5 / 6) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => v + m);
}

/** 相对亮度 */
function luminance([r, g, b]) {
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 对比度 */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function parseHsl(value) {
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (!m) return null;
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * 一组前景/背景的对比度结果
 *
 * @typedef {Object} IslandContrastRow
 * @property {string} theme 主题名：浅色 / 暗色
 * @property {string} fg 前景 token 名
 * @property {string} bg 背景 token 名
 * @property {number} min 这一组要过的线
 * @property {number | null} ratio 对比度；token 缺失时为 null
 */

/**
 * 算出岛的两套主题下，每一对前景/背景的对比度
 *
 * token 缺失时 ratio 为 null —— 那不是「过线」，得单独报出来。
 *
 * @returns {IslandContrastRow[]}
 */
export function buildIslandMatrix() {
  const css = fs.readFileSync(cssPath, "utf8");
  const themes = [
    { label: "浅色", tokens: tokensInBlock(css, ":root") },
    { label: "暗色", tokens: tokensInBlock(css, ".dark") },
  ];

  const rows = [];
  for (const theme of themes) {
    for (const pair of ISLAND_PAIRS) {
      const fg = parseHsl(theme.tokens.get(pair.fg) ?? "");
      const bg = parseHsl(theme.tokens.get(pair.bg) ?? "");
      rows.push({
        theme: theme.label,
        fg: pair.fg,
        bg: pair.bg,
        min: pair.min,
        ratio: fg && bg ? contrast(fg, bg) : null,
      });
    }
  }
  return rows;
}

/* ── 命令行入口 ─────────────────────────────────────────────────────────── */

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  let failed = 0;
  for (const row of buildIslandMatrix()) {
    if (row.ratio === null) {
      console.log(`[跳过] ${row.theme} ${row.fg} / ${row.bg} —— token 缺失`);
      failed++;
      continue;
    }
    const ok = row.ratio >= row.min;
    if (!ok) failed++;
    console.log(
      `${ok ? "过线" : "不过线"}  ${row.theme}  ${row.fg} 压 ${row.bg}  ${row.ratio.toFixed(2)}（要 ${row.min}）`
    );
  }

  if (failed > 0) {
    console.error(`\n灵动岛配色有 ${failed} 处没过线`);
    process.exit(1);
  }
  console.log("\n灵动岛配色全部过线");
}
