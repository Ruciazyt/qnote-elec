
import { createCanvas, px, shift, PALETTE as _BASE } from './pet.mjs';

const C = 32;

export const PALETTE = {
  '.': null,
  k: [0x4a, 0x44, 0x3e],
  w: [0xf7, 0xf4, 0xef],
  s: [0xd8, 0xd2, 0xc8],
  d: [0xb4, 0xac, 0x9e],
  e: [0x2a, 0x25, 0x20],
  p: [0xf5, 0xa9, 0xb8],
  c: [0x8c, 0x4a, 0x3a],
  m: [0xa8, 0x5f, 0x4a],
};


function ellipse(cv, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) px(cv, x, y, color);
    }
  }
}

function box(cv, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) px(cv, x + dx, y + dy, color);
}

function triangle(cv, ax, ay, bx, by, cx, cy, color) {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
      const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) / area;
      const w2 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) px(cv, x, y, color);
    }
  }
}

function line(cv, x1, y1, x2, y2, color, thick = 0) {
  x1 = Math.round(x1); y1 = Math.round(y1);
  x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1);
  const dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  let x = x1;
  let y = y1;
  const maxSteps = 2 * (cv.w + cv.h) + 2;
  let steps = 0;
  for (;;) {
    px(cv, x, y, color);
    for (let t = 1; t <= thick; t++) px(cv, x, y + t, color);
    if ((x === x2 && y === y2) || ++steps > maxSteps) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function outline(cv) {
  const src = cv.data.slice();
  const solid = (x, y) => x >= 0 && y >= 0 && x < cv.w && y < cv.h && src[y * cv.w + x] !== null;
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) {
        cv.data[y * cv.w + x] = PALETTE.k;
      }
    }
  }
}


export const POSES = {
  drag: {
    ear: { cy: 16.5, rx: 2.7, ry: 6.2, innerCy: 17.5 },
  },
  null: null,
};

export function drawMaltese(opt = {}) {
  const { bobY = 0, capePhase = 0, blink = false, squint = false } = opt;
  const pose = POSES[opt.pose ?? "null"] ?? null;
  const cv = createCanvas(C, C);
  const y = bobY;

  const EAR = pose?.ear;
  ellipse(cv, 8.5, (EAR?.cy ?? 15.5) + y, EAR?.rx ?? 2.8, EAR?.ry ?? 5.2, PALETTE.w);
  ellipse(cv, 23.5, (EAR?.cy ?? 15.5) + y, EAR?.rx ?? 2.8, EAR?.ry ?? 5.2, PALETTE.w);
  ellipse(cv, 9.8, (EAR?.innerCy ?? 16.5) + y, 1.4, (EAR?.ry ?? 5.2) - 1.6, PALETTE.d);
  ellipse(cv, 22.2, (EAR?.innerCy ?? 16.5) + y, 1.4, (EAR?.ry ?? 5.2) - 1.6, PALETTE.d);

  ellipse(cv, 16, 24.5 + y, 6.8, 4.6, PALETTE.w);
  ellipse(cv, 15.5, 26.5 + y, 5.4, 2.6, PALETTE.s);

  ellipse(cv, 12.8, 28.5 + y, 2.0, 1.6, PALETTE.w);
  ellipse(cv, 19.2, 28.5 + y, 2.0, 1.6, PALETTE.w);
  ellipse(cv, 12.8, 29.5 + y, 1.4, 0.9, PALETTE.s);
  ellipse(cv, 19.2, 29.5 + y, 1.4, 0.9, PALETTE.s);


  const COLLAR_W = [9, 11, 11, 9];
  for (let row = 20; row <= 23; row++) {
    const w = COLLAR_W[row - 20];
    const x1 = 16 - ((w - 1) >> 1);
    for (let k = 0; k < w; k++) px(cv, x1 + k, row + y, PALETTE.c);
  }
  for (let x = 13; x <= 19; x++) px(cv, x, 21 + y, PALETTE.m);

  const DRAPE = [
    { len: 6, tilt: 0 },
    { len: 7, tilt: 0 },
    { len: 8, tilt: 1 },
    { len: 9, tilt: 1 },
    { len: 8, tilt: 0 },
    { len: 7, tilt: -1 },
  ][capePhase % 6];
  const D0 = 22;
  const DRAPE_H = Math.max(1, DRAPE.len - 1);
  for (let r = 0; r < DRAPE.len; r++) {
    const off = Math.round((DRAPE.tilt * r) / DRAPE_H);
    for (let k = 0; k < 5; k++) px(cv, D0 + off + k, 21 + r + y, PALETTE.c);
    if (r < DRAPE.len - 2) px(cv, D0 + off + 1, 21 + r + y, PALETTE.m);
  }

  ellipse(cv, 16, 9.5 + y, 4.6, 2.6, PALETTE.w);
  ellipse(cv, 11.0, 11 + y, 2.4, 2.2, PALETTE.w);
  ellipse(cv, 21.0, 11 + y, 2.4, 2.2, PALETTE.w);
  line(cv, 16, 7 + y, 16, 10 + y, PALETTE.d);
  triangle(cv, 9, 13 + y, 11, 13 + y, 9.5, 15 + y, PALETTE.s);
  triangle(cv, 23, 13 + y, 21, 13 + y, 22.5, 15 + y, PALETTE.s);

  ellipse(cv, 16, 14.5 + y, 5.6, 5.2, PALETTE.w);
  ellipse(cv, 16, 17.5 + y, 3.0, 2.4, PALETTE.w);
  ellipse(cv, 11.8, 16.8 + y, 1.8, 2.0, PALETTE.s);
  ellipse(cv, 20.2, 16.8 + y, 1.8, 2.0, PALETTE.s);

  outline(cv);

  if (blink) {
    line(cv, 11, 13 + y, 14, 13 + y, PALETTE.e);
    line(cv, 18, 13 + y, 21, 13 + y, PALETTE.e);
  } else if (squint) {
    for (let x = 12; x <= 14; x++) px(cv, x, 12 + y, PALETTE.e);
    for (let x = 18; x <= 20; x++) px(cv, x, 12 + y, PALETTE.e);
    for (let x = 12; x <= 13; x++) px(cv, x, 14 + y, PALETTE.e);
    for (let x = 19; x <= 20; x++) px(cv, x, 14 + y, PALETTE.e);
  } else {
    ellipse(cv, 12.8, 13 + y, 2.0, 2.2, PALETTE.e);
    ellipse(cv, 19.2, 13 + y, 2.0, 2.2, PALETTE.e);
    px(cv, 12, 12 + y, PALETTE.w);
    px(cv, 18, 12 + y, PALETTE.w);
  }

  ellipse(cv, 16, 18 + y, 1.6, 1.3, PALETTE.e);
  px(cv, 15, 19 + y, PALETTE.k);
  px(cv, 17, 19 + y, PALETTE.k);

  const swayX = opt.swayX ?? 0;
  return swayX ? shift(cv, swayX, 0) : cv;
}

export { drawQuestionMark } from './pet.mjs';
