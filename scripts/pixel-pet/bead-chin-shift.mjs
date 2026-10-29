/**
 * bead 第四轮：下巴（吻部）整体下移，补上颈部缝隙，上方空出的空间用面部白色填充
 *
 * 用户诉求（配图说明）：
 *   「把第二张图的下巴部分平移向下一些，填充脖子部分的空隙。平移多出来的空间用面部的白色填充」
 *
 * 实测（v3 网格）：
 *   鼻子/吻部块 = x 26..35, y 27..35
 *     y=27  x=27..33 #bbbbbb   吻部顶缘软边
 *     y=28  x=28..33 #777777   顶盖
 *     y=29..34 x=27..34 #333/#222  鼻梁主体
 *     y=35  x=26..35 #9c/#66/#55/#4d2b1a/#99  鼻底暗块
 *   下方 y=36 起就是围脖 #864b2d，两者仅相接、几乎没有过渡，
 *   下移 N px 后吻部会压进围脖，颈部缝隙即被填死。
 *
 * 做法（不是整块重算，是几何平移）：
 *   1. 先把 x=26..35 / y=27..35 的像素整块取出
 *   2. 下移 N px 写回，越界处自然覆盖围脖顶部
 *   3. 顶部空出的 N 行填 #eeeeee —— 面部白毛在本图里的取值
 *      （y=24..26 的 x=25..35 全部是 #eeeeee）
 *
 * 附带收益：原来鼻顶只有 1 行 #eeeeee 就跳到 #bbbbbb，
 * 下移后变成 #eeeeee x3 -> #bbbbbb -> #777 -> #333 -> #222，过渡更长更顺。
 */
import fs from 'node:fs';
import { W, H, parseSvg, rasterize, toSvg, comparePng, renderPng } from './bead-svg.mjs';

const DIR = 'D:/personal-projects/qnote-elec/scripts/pixel-pet';
const SRC = `${DIR}/makebead-64x68-v3.svg`;
const ORIG = 'D:/新建文件夹/.minimax/v2/assets/2026/10/14/16-06-04-905-asset_20261014-160604-905_f1edc75075c0_e1c89567-makebead-64x68.svg';

/* 吻部块 */
const CX0 = 26, CX1 = 35, CY0 = 27, CY1 = 35;
const WHITE = [0xee, 0xee, 0xee];

/** 鼻色阈值：比它亮的属于面部白毛/过渡，不跟着往下搬 */
const isNose = (c) => c && c[0] < 0xd8;

function shiftDown(before, n) {
  const g = before.slice();
  for (let y = CY0; y <= CY1 + n; y++) {
    for (let x = CX0; x <= CX1; x++) {
      if (y <= CY0 + n - 1) {
        // 顶部空出的 n 行 -> 面部白毛
        g[y * W + x] = WHITE.slice();
      } else if (y <= CY1) {
        // 仍在原块范围内 -> 纯平移
        g[y * W + x] = before[(y - n) * W + x].slice();
      } else {
        // 压进围脖的部分 -> 只搬鼻子的深色，白色留在原地，
        // 否则 (26,36)(27,36) 这类原本属于口鼻侧的白会跟着落进棕色围巾，
        // 在围巾顶边啃出白缺口。
        const src = before[(y - n) * W + x];
        g[y * W + x] = isNose(src) ? src.slice() : before[y * W + x].slice();
      }
    }
  }
  return g;
}

const before = rasterize(parseSvg(fs.readFileSync(SRC, 'utf8')));
const original = rasterize(parseSvg(fs.readFileSync(ORIG, 'utf8')));
const hex = (c) => (c ? '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('') : '...');

/* ---- 两个候选量 ---- */
const cands = [[2, 'v4'], [3, 'v4-shift3']];
const grids = [];
for (const [n, name] of cands) {
  const g = shiftDown(before, n);
  grids.push(g);
  let changed = 0;
  for (let i = 0; i < W * H; i++) if (before[i][0] !== g[i][0]) changed++;
  console.log(`\n--- shift ${n}px  改动 ${changed} 像素 ---`);

  // 校验 1：往返一致性（网格 -> SVG -> 网格 必须 0 差异）
  const info = toSvg(g, `${DIR}/makebead-64x68-${name}.svg`);
  const back = rasterize(parseSvg(fs.readFileSync(`${DIR}/makebead-64x68-${name}.svg`, 'utf8')));
  let rt = 0;
  for (let i = 0; i < W * H; i++) if (hex(back[i]) !== hex(g[i])) rt++;
  console.log(`  往返一致性差异: ${rt}  图层 ${info.layers}  矩形 ${info.rects}`);

  // 校验 2：改动必须全部落在预期带内
  let stray = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (before[y * W + x][0] === g[y * W + x][0]) continue;
    const inBlock = x >= CX0 && x <= CX1 && y >= CY0 && y <= CY1 + n;
    if (!inBlock) stray.push(`(${x},${y})`);
  }
  console.log(`  带外改动: ${stray.length ? stray.join(' ') : '无'}`);

  // 校验 3：鼻底必须已经压到围脖里（不再有 1px 悬空间隙）
  const COL = 30;
  console.log(`  x=${COL} 纵剖面 ${Array.from({ length: 12 }, (_, k) => `${26 + k}:${hex(g[(26 + k) * W + COL]).slice(1)}`).join(' ')}`);
}

console.log('\n=== v3 原剖面 x=30, y=26..37 ===');
console.log(Array.from({ length: 12 }, (_, k) => `${26 + k}:${hex(before[(26 + k) * W + 30]).slice(1)}`).join(' '));

/* ---- 出图 ---- */
comparePng([before, ...grids],
  `${DIR}/makebead-64x68-v4-compare.png`,
  { scale: 15, x0: 10, y0: 16, x1: 52, y1: 42 });
comparePng([original, before, grids[0]],
  `${DIR}/makebead-64x68-original-vs-v4.png`,
  { scale: 9, x0: 0, y0: 0, x1: W, y1: H });
renderPng(grids[0], `${DIR}/tmp-v4-grid.png`,
  { scale: 20, x0: 12, y0: 18, x1: 52, y1: 50, grid: true });
