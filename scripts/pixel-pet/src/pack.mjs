
import fs from 'node:fs';
import path from 'node:path';
import { CELL, SCALE, createCanvas, overlay } from './pet.mjs';
import { encodePng } from './png.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..');

export function toRgba(cv, scale) {
  const w = cv.w * scale;
  const h = cv.h * scale;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cv.data[Math.floor(y / scale) * cv.w + Math.floor(x / scale)];
      const i = (y * w + x) * 4;
      if (c) {
        out[i] = c[0];
        out[i + 1] = c[1];
        out[i + 2] = c[2];
        out[i + 3] = 255;
      }
    }
  }
  return { data: out, w, h };
}

export function writeOutputs(rows, outDir) {
  const outDirAbs = path.resolve(PROJECT_ROOT, outDir);
  const outRel = path.relative(PROJECT_ROOT, outDirAbs);
  if (outRel.startsWith('..') || path.isAbsolute(outRel)) {
    throw new Error(`输出目录必须位于仓库根目录之内: ${outDir}`);
  }

  fs.mkdirSync(outDirAbs, { recursive: true });

  const GAP = 2;
  const ROWS_BIG = 4;
  const rowsTotal = rows.length * 2;
  const previewFrames = rows.flatMap((r) => r.frames);
  const pwSmall = previewFrames.length * CELL * SCALE + (previewFrames.length + 1) * GAP;
  const pwBig = previewFrames.length * CELL + (previewFrames.length + 1) * GAP;
  const pw = Math.max(pwSmall, pwBig) + CELL * ROWS_BIG + GAP * (rowsTotal + 1);
  const ph = rowsTotal * CELL * ROWS_BIG + (rowsTotal + 1) * GAP;
  const preview = createCanvas(pw, ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      preview.data[y * pw + x] = checker ? [0x9a, 0x9a, 0xa0] : [0x7e, 0x7e, 0x86];
    }
  }

  let cursor = GAP;
  let yRow = GAP;
  for (const row of rows) {
    let x = cursor;
    for (const f of row.frames) {
      for (let sy = 0; sy < CELL * SCALE; sy++) {
        for (let sx = 0; sx < CELL * SCALE; sx++) {
          const c = f.data[Math.floor(sy / SCALE) * CELL + Math.floor(sx / SCALE)];
          if (c) preview.data[(yRow + sy) * pw + x + sx] = c;
        }
      }
      x += CELL * SCALE + GAP;
    }
    yRow += CELL * SCALE + GAP;
  }

  cursor = GAP;
  yRow = GAP + rows.length * (CELL * SCALE + GAP) + GAP;
  for (const row of rows) {
    let x = cursor;
    for (const f of row.frames) {
      for (let sy = 0; sy < CELL; sy++) {
        for (let sx = 0; sx < CELL; sx++) {
          const c = f.data[sy * CELL + sx];
          if (!c) continue;
          for (let dy = 0; dy < ROWS_BIG; dy++) {
            for (let dx = 0; dx < ROWS_BIG; dx++) {
              preview.data[(yRow + sy * ROWS_BIG + dy) * pw + x + sx * ROWS_BIG + dx] = c;
            }
          }
        }
      }
      x += CELL * ROWS_BIG + GAP;
    }
    yRow += CELL * ROWS_BIG + GAP;
  }
  const pr = toRgba(preview, 1);
  fs.writeFileSync(path.join(outDirAbs, 'preview.png'), encodePng(pr.data, pr.w, pr.h));

  const total = rows.reduce((n, r) => n + r.frames.length, 0);
  const sheet = createCanvas(total * CELL, CELL);
  let sx = 0;
  for (const row of rows) {
    for (const f of row.frames) {
      overlay(sheet, f, sx, 0);
      sx += CELL;
    }
  }
  const sr = toRgba(sheet, SCALE);
  fs.writeFileSync(path.join(outDirAbs, 'spritesheet.png'), encodePng(sr.data, sr.w, sr.h));

  const meta = { cell: CELL, scale: SCALE, sheetWidth: sr.w, sheetHeight: sr.h, animations: {} };
  let idx = 0;
  for (const row of rows) {
    meta.animations[row.anim] = {
      start: idx,
      frames: row.frames.length,
      fps: row.cfg.fps,
      desc: row.cfg.desc,
    };
    idx += row.frames.length;
  }
  fs.writeFileSync(path.join(outDirAbs, 'pet.json'), JSON.stringify(meta, null, 2));

  return { sheet: sr, preview: pr, total, meta };
}
