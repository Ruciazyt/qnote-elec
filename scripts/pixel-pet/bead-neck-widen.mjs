/**
 * 加粗脖子：把围巾上缘的窄台阶抹平并外扩
 *
 * 实测的围巾轮廓（左缘 / 右缘）：
 *   y=36   x=24..36   (13)
 *   y=37   x=24..36   (13)   <- 脖子最窄处
 *   y=38   x=21..39   (19)
 *   y=39   x=19..41   (23)   下缘已经到头最宽处的一半
 * 头最宽约 48px，所以头 -> 13 -> 19 -> 23 的落差让脖子显得很细。
 *
 * 两个档位，都让左右缘每行各让 1~2px，形成连续的斜坡而不是台阶：
 *   档位1（轻微） y=36:23..37 / y=37:22..38 / y=38 不动
 *   档位2（明显） y=36:22..38 / y=37:21..39 / y=38:20..40
 * 只动棕色围巾自己的边缘，灰色肩部与深色描边一律不碰。
 */
import fs from 'node:fs';
import { W, H, parseSvg, rasterize, toSvg, renderPng, comparePng } from './bead-svg.mjs';

const DIR = 'D:/personal-projects/qnote-elec/scripts/pixel-pet';
const TMP = 'D:/personal-projects/qnote-elec/.tmp-neck';
const OUT = `${DIR}/makebead-64x68-neck.svg`;

const hex = (c) => (c ? c.map((v) => v.toString(16).padStart(2, '0')).join('') : '00');
const BROWN = [0x86, 0x4b, 0x2d];
const BROWN_DARK = [0x86, 0x40, 0x2d];
const isBrown = (c) => c && (hex(c) === hex(BROWN) || hex(c) === hex(BROWN_DARK));
const base = rasterize(parseSvg(fs.readFileSync(`${DIR}/makebead-64x68-base.svg`, 'utf8')));

/** 只允许把「灰色肩部」换成围巾棕，其余像素一旦被动就报错 */
function widen(rows) {
  const g = base.slice();
  for (const { y, x0, x1 } of rows) {
    for (let x = x0; x <= x1; x++) {
      if (isBrown(g[y * W + x])) continue;              // 已经是棕色，保持原样（含深棕条纹）
      const cur = base[y * W + x];
      if (!cur) throw new Error(`(${x},${y}) 是空白像素，不能填棕`);
      g[y * W + x] = BROWN.slice();
    }
  }
  // 越界检查：改动必须全部落在声明的行/列内
  const all = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (hex(base[y * W + x]) !== hex(g[y * W + x])) all.push({ x, y });
  }
  const inside = (p) => rows.some((r) => p.y === r.y && p.x >= r.x0 && p.x <= r.x1);
  const stray = all.filter((p) => !inside(p));
  return { g, all, stray };
}

const GENTLE = [
  { y: 36, x0: 23, x1: 37 },
  { y: 37, x0: 22, x1: 38 },
];
const CLEAR = [
  { y: 36, x0: 22, x1: 38 },
  { y: 37, x0: 21, x1: 39 },
  { y: 38, x0: 20, x1: 40 },
];

const v1 = widen(GENTLE);
const v2 = widen(CLEAR);

console.log('=== 改动清单 ===');
for (const [name, v] of [['档位1 轻微', v1], ['档位2 明显', v2]]) {
  console.log(`  ${name}：共 ${v.all.length} 像素，越界 ${v.stray.length ? JSON.stringify(v.stray) : '无'}`);
  console.log('    ' + v.all.map((p) => `(${p.x},${p.y})`).join(' '));
}

console.log('\n=== 围巾轮廓（改动后）===');
const edge = (g, y) => {
  let a = null, b = null;
  for (let x = 0; x < W; x++) {
    const c = hex(g[y * W + x]);
    if (c === '864b2d' || c === '86402d') {
      if (a === null) a = x;
      b = x;
    }
  }
  return `y=${y}  x=${a}..${b}  宽 ${b - a + 1}`;
};
for (const y of [35, 36, 37, 38, 39]) {
  console.log(`  原图   ${edge(base, y)}`);
  console.log(`  档位1  ${edge(v1.g, y)}`);
  console.log(`  档位2  ${edge(v2.g, y)}`);
}

const variants = [['原图', base], ['档位1 轻微', v1.g], ['档位2 明显', v2.g]];
/* SVG 本体有一层白色底板，而 parseSvg 只吃 <path>，底板会漏成透明；
   comparePng 遇到透明就留成深灰，整张图会全黑，所以先补回白底 */
const flatten = (g) => g.map((c) => c || [0xff, 0xff, 0xff]);
const flat = variants.map(([n, g]) => [n, flatten(g)]);
comparePng(flat.map((v) => v[1]), `${DIR}/makebead-64x68-neck-compare.png`, { scale: 20, x0: 14, y0: 30, x1: 48, y1: 44 });
comparePng(flat.map((v) => v[1]), `${DIR}/makebead-64x68-neck-full-compare.png`, { scale: 9, x0: 0, y0: 0, x1: W, y1: H });
console.log('\n对照顺序：原图 / 档位1 轻微 / 档位2 明显');

toSvg(v2.g, OUT);
renderPng(flatten(v2.g), `${DIR}/makebead-64x68-neck.png`, { scale: 9 });
console.log('\n导出：', OUT);