/**
 * 只平移「下巴线」，鼻子完全不动
 *
 * 上一轮错在把鼻体一起搬了（x=24..36 / y=27..35 整块），导致鼻子被拉长。
 * 本轮只动面部下缘（下巴线）与棕色围巾交界的那条边。
 *
 * 实测的下巴线形状（每列最后一行非棕色像素）：
 *   x=24..36 -> y=35     鼻子正下方，最靠上
 *   x=19..23 -> y=37     左侧肩膀
 *   x=37..41 -> y=38     右侧肩膀
 *   => 围巾在中间比两侧高 2~3px，凸台两旁的暗缝就是「脖子空隙」
 *
 * 两种做法：
 *   全宽下移  每列下巴线统一下移 n px，新占的行填面部白 —— 整条线一起走
 *   仅中央下移 只有 x=24..36 下移，鼻子正下方那截落到与两侧齐平
 * 填充色两种：
 *   纯白   新增行直接填 #cccccc
 *   渐变   #777 -> #444，把下巴暗线保留在最底一行（更符合原来的明暗走向）
 */
import fs from 'node:fs';
import { W, H, parseSvg, rasterize, toSvg, renderPng, comparePng } from './bead-svg.mjs';

const DIR = 'D:/personal-projects/qnote-elec/scripts/pixel-pet';
const base = rasterize(parseSvg(fs.readFileSync('D:/personal-projects/qnote-elec/.tmp2/orig.svg', 'utf8')));

const BROWN = new Set(['#864b2d','#86402d','#bf5b40','#866a2d','#bf6a40','#d28a79','#4d2b1a','#e6bfb3']);
const hex = (c) => c ? '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('') : '...';
const isBrown = (c) => c && BROWN.has(hex(c));

function chinMap(g) {
  const m = {};
  for (let x = 0; x < W; x++) {
    let y = null;
    for (let yy = 26; yy <= 40; yy++) {
      const c = g[yy * W + x];
      if (!c || isBrown(c)) break;
      y = yy;
    }
    if (y != null) m[x] = y;
  }
  return m;
}

/** 把指定列的下巴线整体下移 n px；fillAt 返回该列新增行的颜色 */
function lower(g, n, cols, fillAt) {
  const out = g.slice();
  const cm = chinMap(g);
  for (const x of cols) {
    const cy = cm[x];
    if (cy == null) continue;
    for (let k = 1; k <= n; k++) {
      const y = cy + k;
      if (y >= H) break;
      out[y * W + x] = fillAt(k, base[(cy) * W + x], cy, y);
    }
  }
  return out;
}

const N = 2;
const CENTRE = Array.from({ length: 13 }, (_, i) => 24 + i);   // x=24..36
const ALL = Object.keys(chinMap(base)).map(Number).filter((x) => x >= 12 && x <= 54);

const WHITE_FILL = (k) => [0xcc, 0xcc, 0xcc];
const GRAD_FILL = (k, edge) => (k === 1 ? [0x77, 0x77, 0x77] : edge.slice());

const variants = [
  ['原图', base],
  ['仅中央+2·纯白', lower(base, N, CENTRE, WHITE_FILL)],
  ['仅中央+2·渐变', lower(base, N, CENTRE, GRAD_FILL)],
  ['全宽+2·渐变', lower(base, N, ALL, GRAD_FILL)],
];

for (const [name, g] of variants.slice(1)) {
  let changed = 0, stray = [];
  const cm = chinMap(base);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (hex(base[y * W + x]) === hex(g[y * W + x])) continue;
    changed++;
    const cy = cm[x];
    if (cy == null || y <= cy || y > cy + N) stray.push(`(${x},${y})`);
  }
  console.log(`${name}: 改动 ${changed} 像素，越界 ${stray.length ? stray.join(' ') : '无'}`);
}

console.log('\n=== 下巴线纵剖面 x=22 / x=30 / x=38, y=33..40 ===');
for (const x of [22, 30, 38]) {
  console.log(`  x=${x}`);
  for (const [name, g] of variants) {
    console.log(`    ${name.padEnd(14)} ` + Array.from({ length: 8 }, (_, k) => `${33 + k}:${hex(g[(33 + k) * W + x]).slice(1)}`).join(' '));
  }
}

comparePng(variants.map((v) => v[1]), `${DIR}/makebead-64x68-chinline-ab.png`, { scale: 22, x0: 14, y0: 26, x1: 46, y1: 44 });
comparePng(variants.map((v) => v[1]), `${DIR}/makebead-64x68-chinline-full.png`, { scale: 9, x0: 0, y0: 0, x1: W, y1: H });
console.log('\n对照顺序：原 / 仅中央+2纯白 / 仅中央+2渐变 / 全宽+2渐变');

/* 导出 SVG 供你直接取用 */
toSvg(variants[2][1], `${DIR}/makebead-64x68-chinline-centre.svg`);
toSvg(variants[3][1], `${DIR}/makebead-64x68-chinline-all.svg`);
renderPng(variants[2][1], `${DIR}/preview-chinline-centre.png`, { scale: 11, x0: 0, y0: 0, x1: W, y1: H });