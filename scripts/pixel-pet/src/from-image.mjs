/**
 * 图片转换器 —— 把一张现成的角色图变成像素宠物的精灵图
 *
 * 存在的原因：程序化生成（build.mjs + maltese.mjs）能精确控制每一像素，
 * 但画不出用户心里那只具体的狗。与其用代码去临摹一只品种，
 * 不如直接用用户给的图，再把「截图级」的输入收拾成像素画。
 *
 * 这条路线要解决三件事，缺一件成品就会明显不对劲：
 *
 * 1. **抠背景**。手机截图 / QQ 表情导出的 PNG 常常没有 alpha 通道，
 *    棋盘格或纯色底是烤进像素里的。判据不能用「是不是某个具体颜色」，
 *    要用一整条范围规则 —— 不同工具导出的底色深浅不一，
 *    写死一个 RGB 值换个来源就失效，而且是静默失效（抠不干净但不报错）。
 *
 * 2. **降采样**。源图 256x270，格子只有 32x32。直接最近邻会在轮廓上
 *    留下锯齿与断线。这里按「块内众数」取色而不是取平均：
 *    平均会把描边和白毛糊成一圈灰边，众数只认块里占比最高的那一族颜色，
 *    轮廓因此保持锐利。
 *
 * 3. **限色**。源图有五千多种颜色（大量是抗锯齿中间色）。
 *    像素画的质感来自「平涂 + 有限色数」，不压色就成了低清插画。
 *    按出现频次挑主色，再把其余像素吸附到最近的主色。
 *
 * 依赖：只用 Node 内置 zlib 与 fs，PNG 编解码在 png.mjs，产物写出在 pack.mjs，
 * 与程序化生成器共用，因此两边产物同构，运行时不需要区分。
 */

import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from './png.mjs';
import {
  CELL,
  ANIMATIONS,
  createCanvas,
  clone,
  overlay,
  shift,
  tilt,
  drawQuestionMark,
} from './pet.mjs';
import { writeOutputs } from './pack.mjs';

const SRC = path.resolve(import.meta.dirname, '../assets/scarf-dog.png');

/* ------------------------------------------------------------------ */
/* 版面参数                                                            */
/* ------------------------------------------------------------------ */

/**
 * 角色在 32x32 格子里的占位上限
 *
 * 留出余量是刚需，不是排版偏好：三个动画都要整体位移，
 * 画得顶天立地的话，向上 1px 就会被格子裁掉半条狗的耳朵。
 * 这里按最大边 24px 装箱（横 23px 上限），高恰好占 24 行。
 */
const FIT_MAX_W = 23;
const FIT_MAX_H = 24;

/**
 * 调色板主色之间的最小距离（RGB 欧氏距离）
 *
 * 定 30 的依据：狗身上真实存在的层次间距远大于它
 * （白毛 235,233,228 与浅阴影 206,200,191 相差约 57，
 *   红围巾 134,71,56 与深色描边 71,66,60 相差约 63，
 *   围巾亮部 157,89,70 与围巾本色 134,71,56 相差约 32），
 * 而抗锯齿产生的中间色间距通常在 15~28。
 * 取中间的值能把「同一个色系的渐变」合并掉，
 * 又不会把「明暗两个层次」压成一层 ——
 * 压暗部尤其致命，白毛角色失去中间调之后会变成一块平贴纸。
 */
const PALETTE_MIN_DIST = 30;

/** 调色板主色上限。像素画超过这个数就往插画跑了 */
const PALETTE_MAX_COLORS = 10;

/** 一个格子里前景像素占比低于这个值就整格判透明，用来削掉抗锯齿光晕 */
const COVERAGE_MIN = 0.34;

/* ------------------------------------------------------------------ */
/* 1. 背景/主体判定                                                    */
/* ------------------------------------------------------------------ */

/** RGB 欧氏距离 */
function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 阶段一：取图像四边的一圈像素作为背景参考色
 *
 * 直接采样而不写死颜色值 —— 棋盘格有两种底色、导出工具还会给每种底色
 * 配几个压缩变体，写死一个 RGB 换个来源就失效，而且是静默失效。
 *
 * 环宽取 3px：比这更窄会采到狗的轮廓，比这更宽没有必要。
 */
function sampleBorderColors(img, ring = 3) {
  const { width: w, height: h, channels: ch, data } = img;
  const hist = new Map();
  for (let y = 0; y < h; y++) {
    const onEdgeY = y < ring || y >= h - ring;
    for (let x = 0; x < w; x++) {
      if (!onEdgeY && x >= ring && x < w - ring) continue;
      const i = (y * w + x) * ch;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  return [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);
}

/**
 * 阶段一：取「确定是狗」的核心像素的高频色作为主体参考色
 *
 * 判定用一条保守的范围规则即可，因为这里只要拿高频色、不要精确掩膜：
 * 抗锯齿过渡色虽然数量不少，但真正决定角色识别的是大面积平涂色，
 * 按频次取前几名，参考色自然落在狗身上。
 */
function sampleCoreColors(img, limit = 8) {
  const { width: w, height: h, channels: ch, data } = img;
  const hist = new Map();
  for (let p = 0; p < w * h; p++) {
    const i = p * ch;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 冷偏蓝、灰阶、亮度居中 —— 棋盘格底的样子
    const looksLikeBackdrop = b - r >= 2 && Math.abs(r - g) <= 3 && r >= 115 && r <= 155;
    if (looksLikeBackdrop) continue;
    const key = (r << 16) | (g << 8) | b;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  return [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);
}

/**
 * 阶段二：最近邻判定每个像素是背景还是主体
 *
 * 为什么必须分两阶段：源图有抗锯齿，轮廓外侧 2~3px 是「狗色↔背景色」的渐变，
 * 这层里的颜色既有暖的（靠狗那侧）也有冷的（靠背景那侧）。
 * 任何单条阈值都只能切在一半位置上，判错的那一半会在成图里变成一圈灰色麻点：
 *  - 只按亮度切，会啃掉耳朵的浅阴影
 *  - 只按冷暖切，会在红围巾外面留下一圈暗红毛边
 * 最近邻不需要阈值去猜，它只问「这像素更像背景还是更像狗」。
 *
 * 距离相等时判背景：宁可削掉轮廓最外一圈，也不要留麻点。
 */
function makeBackgroundTest(img) {
  const bgRefs = sampleBorderColors(img);
  const fgRefs = sampleCoreColors(img);
  return (r, g, b) => {
    const c = [r, g, b];
    let db = Infinity;
    for (const ref of bgRefs) db = Math.min(db, dist(c, ref));
    let df = Infinity;
    for (const ref of fgRefs) df = Math.min(df, dist(c, ref));
    return db <= df;
  };
}

/** 取非背景像素的紧包围盒 */
function tightBox(img, isBackground) {
  const { width: w, height: h, channels: ch, data } = img;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      if (isBackground(data[i], data[i + 1], data[i + 2])) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('整张图都被判定为背景，抠图规则可能失效');
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* ------------------------------------------------------------------ */
/* 2. 块内众数降采样                                                  */
/* ------------------------------------------------------------------ */

/**
 * 把源图区域降采样到 dw x dh，颜色取块内众数
 *
 * 计数时按 5bit 分桶（每通道 >>3）而不是按精确 RGB：
 * 抗锯齿会在同一族白里造出上百个几乎相同的值，
 * 按精确值计数等于每桶都只有一两个样本，众数就退化成随机取值。
 * 分桶后同一族白聚成一大桶，众数才有意义。
 */
function downsampleByMode(img, box, dw, dh, isBackground) {
  const { width: W, channels: ch, data } = img;
  const out = new Array(dw * dh).fill(null);

  for (let ty = 0; ty < dh; ty++) {
    const sy0 = box.y + Math.floor((ty * box.h) / dh);
    const sy1 = box.y + Math.max(ty + 1, Math.ceil(((ty + 1) * box.h) / dh));
    for (let tx = 0; tx < dw; tx++) {
      const sx0 = box.x + Math.floor((tx * box.w) / dw);
      const sx1 = box.x + Math.max(tx + 1, Math.ceil(((tx + 1) * box.w) / dw));

      /** 色桶 -> {n, r, g, b}，同时累计前景总数 */
      const buckets = new Map();
      let fg = 0;
      let total = 0;
      for (let sy = sy0; sy < sy1 && sy < img.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < W; sx++) {
          const i = (sy * W + sx) * ch;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          total++;
          if (isBackground(r, g, b)) continue;
          fg++;
          const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          cur.n++;
          cur.r += r;
          cur.g += g;
          cur.b += b;
          buckets.set(key, cur);
        }
      }
      if (!total || fg / total < COVERAGE_MIN) continue;

      let best = null;
      for (const cur of buckets.values()) if (!best || cur.n > best.n) best = cur;
      out[ty * dw + tx] = [
        Math.round(best.r / best.n),
        Math.round(best.g / best.n),
        Math.round(best.b / best.n),
      ];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3. 限色                                                            */
/* ------------------------------------------------------------------ */

/**
 * 按频次挑主色，其余像素吸附到最近主色
 *
 * 先按出现次数降序，再贪心收「离已有主色够远」的颜色。
 * 用频次当优先级是关键：抗锯齿中间色数量其实不少，
 * 但真正决定角色识别的是大面积平涂色，必须让它们先占位。
 */
function quantize(pixels) {
  const hist = new Map();
  for (const c of pixels) {
    if (!c) continue;
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);

  const palette = [];
  for (const [key] of sorted) {
    if (palette.length >= PALETTE_MAX_COLORS) break;
    const c = [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff];
    const far = palette.every(
      (p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) >= PALETTE_MIN_DIST
    );
    if (far) palette.push(c);
  }

  const nearest = (c) => {
    let best = palette[0];
    let bestD = Infinity;
    for (const p of palette) {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  return { palette, snapped: pixels.map((c) => (c ? nearest(c) : null)) };
}

/* ------------------------------------------------------------------ */
/* 4. 帧配方                                                          */
/* ------------------------------------------------------------------ */

/**
 * 每帧的位移配方
 *
 * bobY   整只上下位移。idle 走 0/-1/1 的对称呼吸，首尾帧同值，循环无跳变；
 *        thinking 走 0/1 的高频点头，6fps 下读作「急切」；
 *        drag 整体抬高，脱离地面的悬空感。
 * swayX  刚体横移
 * tilt   绕垂直中线的剪切强度，让轮廓真的歪，配合 swayX 组成钟摆。
 *        只平移不剪切，拖拽帧会像贴图在滑动而不是被拎起来晃。
 * mark   问号浮层相位；undefined 表示不画
 */
const RECIPES = {
  idle: [
    { bobY: 0, swayX: 0, tilt: 0 },
    { bobY: -1, swayX: 0, tilt: 0 },
    { bobY: -1, swayX: 0, tilt: 0 },
    { bobY: 0, swayX: 0, tilt: 0 },
    { bobY: 1, swayX: 0, tilt: 0 },
    { bobY: 0, swayX: 0, tilt: 0 },
  ],
  thinking: [
    { bobY: 1, swayX: 0, tilt: 0, mark: 0 },
    { bobY: 0, swayX: 0, tilt: 0, mark: 1 },
    { bobY: 1, swayX: 0, tilt: 0, mark: 2 },
    { bobY: 0, swayX: 0, tilt: 0, mark: 3 },
    { bobY: 1, swayX: 0, tilt: 0, mark: 2 },
    { bobY: 0, swayX: 0, tilt: 0, mark: 1 },
    { bobY: 1, swayX: 0, tilt: 0, mark: 0 },
    { bobY: 0, swayX: 0, tilt: 0, mark: 3 },
  ],
  drag: [
    // 帧数必须是 8：钟摆序列 [+2,+1,0,-1,-2,-1,0,+1] 首尾差 1px，循环接缝才看不出来
    { bobY: -2, swayX: 2, tilt: 2 },
    { bobY: -2, swayX: 1, tilt: 1 },
    { bobY: -1, swayX: 0, tilt: 0 },
    { bobY: -2, swayX: -1, tilt: -1 },
    { bobY: -2, swayX: -2, tilt: -2 },
    { bobY: -3, swayX: -1, tilt: -1 },
    { bobY: -2, swayX: 0, tilt: 0 },
    { bobY: -3, swayX: 1, tilt: 1 },
  ],
};

/**
 * 各动画在本角色上的具体动作，写进 pet.json 的 desc
 *
 * 必须按生成器各写一份：ANIMATIONS 里的 desc 描述的是马尔济斯的画法
 * （披风相位、眨眼、垂耳），照搬到这只狗身上就是错的描述。
 * pet.json 不参与运行时，但它是交接物 —— 别人照着它排查动画问题，
 * 写错的动作描述比没有描述更误导人。
 */
const ANIM_DESC = {
  idle: '待机：整只缓慢上下起伏（呼吸节奏），6 帧一循环',
  thinking: '思考中：高频点头 + 头顶问号四相闪烁，8 帧一循环',
  drag: '被拖拽中：整体抬高悬空，整体横摆并绕中线剪切出钟摆倾斜，8 帧一循环',
};

/* ------------------------------------------------------------------ */
/* 主流程                                                             */
/* ------------------------------------------------------------------ */

/** 生成一只不动的基准帧（32x32，角色居中） */
function buildBase() {
  const img = decodePng(fs.readFileSync(SRC));
  const isBackground = makeBackgroundTest(img);
  const box = tightBox(img, isBackground);

  // 等比装箱到 FIT_MAX_W x FIT_MAX_H
  const scale = Math.min(FIT_MAX_W / box.w, FIT_MAX_H / box.h);
  const dw = Math.max(1, Math.round(box.w * scale));
  const dh = Math.max(1, Math.round(box.h * scale));

  const small = downsampleByMode(img, box, dw, dh, isBackground);
  const { palette, snapped } = quantize(small);

  const base = createCanvas(CELL, CELL);
  const ox = Math.floor((CELL - dw) / 2);
  const oy = Math.floor((CELL - dh) / 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const c = snapped[y * dw + x];
      if (c) base.data[(oy + y) * CELL + ox + x] = c;
    }
  }
  return { base, box, dw, dh, ox, oy, palette };
}

function buildFrame(base, recipe) {
  // 必须先复制：某几帧的位移参数全是 0，tilt/shift 会直接原样返回 base，
  // 随后的 overlay 就会把浮层烧进基准帧，之后所有帧都带着它。
  let cv = clone(base);
  if (recipe.tilt) cv = tilt(cv, recipe.tilt);
  if (recipe.swayX) cv = shift(cv, recipe.swayX, 0);
  if (recipe.bobY) cv = shift(cv, 0, recipe.bobY);
  if (recipe.mark !== undefined) cv = overlay(cv, drawQuestionMark(recipe.mark));
  return cv;
}

/** 帧内非透明像素的包围盒 */
function frameBounds(cv) {
  let minX = cv.w;
  let maxX = -1;
  let minY = cv.h;
  let maxY = -1;
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      if (!cv.data[y * cv.w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * 贴边检查
 *
 * 单元格外的像素会被直接丢弃，所以「某一帧的位移正好把身体推出格子」
 * 这类错误不会报错，只会表现为动画循环到那一帧时狗忽然缺一块耳朵 ——
 * 排查时很容易被当成图集错位。这里主动检查并告警。
 */
function warnOnEdgeTouch(rows) {
  for (const row of rows) {
    row.frames.forEach((f, i) => {
      const b = frameBounds(f);
      const edges = [];
      if (b.minX === 0) edges.push('左');
      if (b.minX < 0) edges.push('越界左');
      if (b.minY === 0) edges.push('上');
      if (b.minY < 0) edges.push('越界上');
      if (b.maxX === CELL - 1) edges.push('右');
      if (b.maxX > CELL - 1) edges.push('越界右');
      if (b.maxY === CELL - 1) edges.push('下');
      if (b.maxY > CELL - 1) edges.push('越界下');
      if (edges.length) {
        console.warn(`  ! ${row.anim} 第 ${i} 帧贴边（${edges.join('/')}），可能已被裁掉`);
      }
    });
  }
}

function main() {
  const outDir = path.resolve(
    process.argv[2] || path.resolve(import.meta.dirname, '../../../src/renderer/public/pixel-pet')
  );

  const { base, box, dw, dh, ox, oy, palette } = buildBase();

  const rows = [];
  for (const [anim, cfg] of Object.entries(ANIMATIONS)) {
    rows.push({
      anim,
      cfg: { ...cfg, desc: ANIM_DESC[anim] },
      frames: Array.from({ length: cfg.frames }, (_, i) => buildFrame(base, RECIPES[anim][i])),
    });
  }

  const { sheet, preview, total, meta } = writeOutputs(rows, outDir);
  warnOnEdgeTouch(rows);

  console.log('源图:', `${box.w}x${box.h}`, '->', `占位 ${dw}x${dh}`, `左上角 (${ox},${oy})`);
  console.log('调色板', palette.length, '色:');
  for (const c of palette) {
    console.log(
      `  rgb(${c.join(',')})  #${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
    );
  }
  console.log('spritesheet:', `${sheet.w}x${sheet.h}`, `(${total} frames)`);
  for (const [anim, m] of Object.entries(meta.animations)) {
    console.log(`  ${anim}: start=${m.start} frames=${m.frames} fps=${m.fps}`);
  }
  console.log('preview:', `${preview.w}x${preview.h}`);
}

main();
