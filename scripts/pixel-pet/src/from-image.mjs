
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

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..');


const FIT_MAX_W = 23;
const FIT_MAX_H = 24;

const PALETTE_MIN_DIST = 30;

const PALETTE_MAX_COLORS = 10;

const COVERAGE_MIN = 0.34;


function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

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

function sampleCoreColors(img, limit = 8) {
  const { width: w, height: h, channels: ch, data } = img;
  const hist = new Map();
  for (let p = 0; p < w * h; p++) {
    const i = p * ch;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
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


function downsampleByMode(img, box, dw, dh, isBackground) {
  const { width: W, channels: ch, data } = img;
  const out = new Array(dw * dh).fill(null);

  for (let ty = 0; ty < dh; ty++) {
    const sy0 = box.y + Math.floor((ty * box.h) / dh);
    const sy1 = box.y + Math.max(ty + 1, Math.ceil(((ty + 1) * box.h) / dh));
    for (let tx = 0; tx < dw; tx++) {
      const sx0 = box.x + Math.floor((tx * box.w) / dw);
      const sx1 = box.x + Math.max(tx + 1, Math.ceil(((tx + 1) * box.w) / dw));

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

const ANIM_DESC = {
  idle: '待机：整只缓慢上下起伏（呼吸节奏），6 帧一循环',
  thinking: '思考中：高频点头 + 头顶问号四相闪烁，8 帧一循环',
  drag: '被拖拽中：整体抬高悬空，整体横摆并绕中线剪切出钟摆倾斜，8 帧一循环',
};


function buildBase() {
  const img = decodePng(fs.readFileSync(SRC));
  const isBackground = makeBackgroundTest(img);
  const box = tightBox(img, isBackground);

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
  let cv = clone(base);
  if (recipe.tilt) cv = tilt(cv, recipe.tilt);
  if (recipe.swayX) cv = shift(cv, recipe.swayX, 0);
  if (recipe.bobY) cv = shift(cv, 0, recipe.bobY);
  if (recipe.mark !== undefined) cv = overlay(cv, drawQuestionMark(recipe.mark));
  return cv;
}

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

  const rel = path.relative(PROJECT_ROOT, outDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(`❌ 输出目录必须位于仓库根目录之内: ${process.argv[2]}`);
    console.error(`   仓库根目录: ${PROJECT_ROOT}`);
    process.exit(1);
  }

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
