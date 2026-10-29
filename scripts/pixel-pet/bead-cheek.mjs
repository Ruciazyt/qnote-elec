/**
 * bead 腮红第三轮：缩小腮红 + 耳朵一侧补白
 *
 * 用户在对照图上圈了 x=36..52 / y=17..38（右眼到头部右缘）并说明：
 *   「这一部分的颜色可以做成腮红，腮红可以小一点。然后耳朵这边需要一些白色。左边也是同样处理」
 *
 * 圈内实测（上一版）：
 *   y=29  x=36..52: e e c c c b a a a a b b a b d e d
 *                            └腮红#aa┘ └#99┘
 *                            x=42..45   x=46..48
 *
 * 两个问题都定位到了：
 *   1. 腮红核心 #aa 宽约 6px（x=42..45）—— 收窄到约 4px
 *   2. x=46..48 是一条 #99 深带 —— 这不是原图的东西，是上一版
 *      「外缘轮廓暗化」加上去的，正好压在腮红与耳朵之间。
 *      删掉它，该处自然回落到白毛。
 *
 * 沿用的做法：调制而非替换，权重在边界恒为 0，连续性由构造保证。
 */
import fs from 'node:fs';
import { W, H, parseSvg, rasterize, toSvg, comparePng, renderPng } from './bead-svg.mjs';

const SRC = 'D:/新建文件夹/.minimax/v2/assets/2026/10/14/16-06-04-905-asset_20261014-160604-905_f1edc75075c0_e1c89567-makebead-64x68.svg';
const PREV = 'D:/personal-projects/qnote-elec/scripts/pixel-pet/makebead-64x68-chinfix.svg';
const OUT  = 'D:/personal-projects/qnote-elec/scripts/pixel-pet/makebead-64x68-v3.svg';

const original = rasterize(parseSvg(fs.readFileSync(SRC, 'utf8')));
const before  = rasterize(parseSvg(fs.readFileSync(PREV, 'utf8')));
const g = before.slice();

const WHITE = 238, BLUSH = 166, EDGE = 150;
const mix = (a, b, t) => a + (b - a) * t;
const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (t) => { const u = c01(t); return u * u * (3 - 2 * u); };

/* ---- 腮红几何（用左侧坐标定义，右侧 x -> 63-x 镜像）----
 * 上一版 RX=2.6 / RY=3.7 → 渲染出来约 6.8px 宽、9.6px 高，腮红过大。
 * 这一版收到 1.55 / 2.35 → 约 4.0px 宽、6.1px 高，核心仍落在眼睛正下方。 */
const CX = 19.6, CY = 29.6, RX = 1.55, RY = 2.35;
/* 纵向权重范围必须避开眼睛行(y<=25)与围巾行(y>=36)：
   眼睛是深灰(#222/#333)，围巾是棕色，两者都不该被提亮。 */
const WY0 = 25, WY1 = 35;

for (let side = 0; side < 2; side++) {
  for (let lx = 11; lx <= 28; lx++) {
    const x = side === 0 ? lx : 63 - lx;
    for (let y = WY0; y <= WY1 + 2; y++) {
      const orig = before[y * W + x];
      if (!orig) continue;
      // 只处理灰阶；棕色围脖、深色眼睛都不在这一档里
      const [r, gg, b] = orig;
      if (Math.abs(r - gg) > 6 || Math.abs(gg - b) > 6) continue;
      if (r <= 0x66) continue;                    // 眼睛/鼻子的深色核心不动

      // --- 目标场 ---
      let v = WHITE;
      v = mix(v, BLUSH, ss(1.3 - Math.hypot((lx - CX) / RX, (y - CY) / RY)) * 0.92);
      // 注意：这里**没有**外缘压暗项。上一版有 `c01((16-lx)/3)*0.85`，
      // 渲染出来在 x=46..48 压出一条 #99 深带，正好卡在腮红与耳朵之间。
      // 用户要的就是那一块变白，删掉后该处自然回落到白毛。
      v = mix(v, EDGE, c01((y - 32) / 4.5) * 0.45);              // 下缘接围巾阴影

      // --- 调制权重：边界恒为 0，过渡带保证每行只走一小步 ---
      // 外侧带收窄到 6px：原先用 8px 时 lx=15 处的权重只有 0.74，
      // 耳侧那块（x=46..49）提亮不足，仍停在 #b5~#c6，没真正白起来。
      const wx = ss((lx - 11) / 6) * ss((28 - lx) / 7);
      const wy = ss((y - WY0) / 8) * ss((WY1 + 2 - y) / 8);
      const w = wx * wy;
      if (w <= 0.001) continue;

      const nv = Math.round(orig[0] + (v - orig[0]) * w);
      g[y * W + x] = [nv, nv, nv];
    }
  }
}

/* ---- 校验：只看脸部内部的灰阶区，背景与眼睛/围脖交界不参与 ---- */
const isGray = (c) => c && Math.abs(c[0] - c[1]) <= 6 && Math.abs(c[1] - c[2]) <= 6;
const inFace = (x, y) => y >= 26 && y <= 35 && x >= 12 && x <= 27;
const inFaceR = (x, y) => y >= 26 && y <= 35 && x >= 36 && x <= 51;
let changed = 0, maxIn = 0, badIn = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const a = before[y * W + x], b = g[y * W + x];
    if (a && b && a[0] !== b[0]) changed++;
    if (!isGray(b)) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= W || ny >= H) continue;
      const n = g[ny * W + nx];
      if (!isGray(n)) continue;
      if (!((inFace(x, y) && inFace(nx, ny)) || (inFaceR(x, y) && inFaceR(nx, ny)))) continue;
      const d = Math.abs(b[0] - n[0]);
      maxIn = Math.max(maxIn, d);
      if (d > 20) badIn.push(`(${x},${y})->(${nx},${ny})=${d}`);
    }
  }
}
console.log('改动像素:', changed);
console.log('腮红区内部最大相邻阶差:', maxIn, '(阈值 20)');
console.log('超阈值:', badIn.length ? [...new Set(badIn)].slice(0, 20).join(' ') : '无');
// 左右对称性自检
let asym = [];
for (let y = 26; y <= 35; y++) for (let lx = 12; lx <= 27; lx++) {
  const l = g[y * W + lx], r = g[y * W + (63 - lx)];
  if (Math.abs(l[0] - r[0]) > 12) asym.push(`(x${lx},y${y}) L=${l[0].toString(16)} R=${r[0].toString(16)}`);
}
console.log('左右不对称处:', asym.length ? asym.slice(0, 10).join(' ') : '无');

const info = toSvg(g, OUT);
console.log('wrote', OUT, `图层 ${info.layers}`, `矩形 ${info.rects}`);
comparePng([original, before, g],
  'D:/personal-projects/qnote-elec/scripts/pixel-pet/makebead-64x68-original-vs-v3.png',
  { scale: 9, x0: 0, y0: 0, x1: W, y1: H });
comparePng([before, g],
  'D:/personal-projects/qnote-elec/scripts/pixel-pet/makebead-64x68-v3-compare.png',
  { scale: 15, x0: 8, y0: 16, x1: 56, y1: 40 });
renderPng(g, 'D:/personal-projects/qnote-elec/scripts/pixel-pet/tmp-v3-zoom.png',
  { scale: 20, x0: 36, y0: 17, x1: 53, y1: 38, grid: true });