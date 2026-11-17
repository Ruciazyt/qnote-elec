
import { createCanvas, px, PALETTE } from './pet.mjs';

const C = 32;

function ellipse(cv, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) px(cv, x, y, color);
    }
  }
}

function ellipseOutline(cv, cx, cy, rx, ry, color, thickness = 1) {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1.0 && d >= (1 - thickness / Math.min(rx, ry)) ** 2) px(cv, x, y, color);
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

export function drawCat(opt = {}) {
  const { bobY = 0, tailPhase = 0, blink = false, squint = false } = opt;
  const cv = createCanvas(C, C);
  const y = bobY;

  const tailPos = [
    [[28, 24 + y], [30, 22 + y], [31, 19 + y], [31, 16 + y]],
    [[28, 24 + y], [30, 23 + y], [31, 21 + y], [30, 18 + y]],
    [[28, 24 + y], [29, 22 + y], [29, 19 + y], [27, 17 + y]],
    [[28, 24 + y], [27, 22 + y], [26, 19 + y], [26, 16 + y]],
    [[28, 24 + y], [27, 23 + y], [26, 21 + y], [25, 18 + y]],
    [[28, 24 + y], [28, 22 + y], [27, 19 + y], [27, 17 + y]],
  ][tailPhase % 6];
  for (let i = 0; i < tailPos.length - 1; i++) {
    const [x1, y1] = tailPos[i];
    const [x2, y2] = tailPos[i + 1];
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let s = 0; s <= steps; s++) {
      const tx = Math.round(x1 + ((x2 - x1) * s) / steps);
      const ty = Math.round(y1 + ((y2 - y1) * s) / steps);
      px(cv, tx, ty, PALETTE.f);
      if (s < steps) px(cv, tx, ty + 1, PALETTE.f);
    }
  }
  const [tx, ty] = tailPos[tailPos.length - 1];
  px(cv, tx, ty, PALETTE.l);
  px(cv, tx, ty + 1, PALETTE.s);

  ellipse(cv, 16, 23 + y, 8, 6.5, PALETTE.f);
  ellipse(cv, 16, 25 + y, 4.5, 4, PALETTE.c);
  ellipse(cv, 12, 28.5 + y, 2.5, 1.5, PALETTE.c);
  ellipse(cv, 20, 28.5 + y, 2.5, 1.5, PALETTE.c);
  px(cv, 11, 29 + y, PALETTE.p);
  px(cv, 13, 29 + y, PALETTE.p);
  px(cv, 19, 29 + y, PALETTE.p);
  px(cv, 21, 29 + y, PALETTE.p);

  triangle(cv, 8, 11 + y, 12, 4 + y, 15, 12 + y, PALETTE.f);
  triangle(cv, 17, 12 + y, 20, 4 + y, 24, 11 + y, PALETTE.f);
  triangle(cv, 10, 10 + y, 12, 6 + y, 14, 11 + y, PALETTE.p);
  triangle(cv, 18, 11 + y, 20, 6 + y, 22, 10 + y, PALETTE.p);

  ellipse(cv, 16, 14 + y, 9, 7.5, PALETTE.f);
  ellipse(cv, 16, 17 + y, 5, 3, PALETTE.c);

  outline(cv);

  if (blink) {
    box(cv, 11, 14 + y, 4, 1, PALETTE.k);
    box(cv, 18, 14 + y, 4, 1, PALETTE.k);
  } else if (squint) {
    box(cv, 12, 14 + y, 2, 1, PALETTE.k);
    box(cv, 19, 14 + y, 2, 1, PALETTE.k);
  } else {
    box(cv, 10, 11 + y, 5, 5, PALETTE.k);
    box(cv, 17, 11 + y, 5, 5, PALETTE.k);
    box(cv, 11, 12 + y, 3, 3, PALETTE.w);
    box(cv, 18, 12 + y, 3, 3, PALETTE.w);
    box(cv, 12, 13 + y, 2, 3, PALETTE.e);
    box(cv, 19, 13 + y, 2, 3, PALETTE.e);
    px(cv, 11, 12 + y, [0xff, 0xff, 0xff]);
    px(cv, 18, 12 + y, [0xff, 0xff, 0xff]);
  }

  px(cv, 15, 16 + y, PALETTE.p);
  px(cv, 16, 16 + y, PALETTE.p);
  box(cv, 16, 17 + y, 1, 1, PALETTE.k);
  px(cv, 15, 18 + y, PALETTE.k);
  px(cv, 17, 18 + y, PALETTE.k);

  box(cv, 8, 16 + y, 2, 1, PALETTE.k);
  box(cv, 8, 18 + y, 1, 1, PALETTE.k);
  box(cv, 23, 16 + y, 2, 1, PALETTE.k);
  box(cv, 24, 18 + y, 1, 1, PALETTE.k);

  box(cv, 14, 7 + y, 1, 2, PALETTE.s);
  box(cv, 17, 7 + y, 1, 2, PALETTE.s);

  return cv;
}

function outline(cv) {
  const src = cv.data.slice();
  const isOpaque = (x, y) => x >= 0 && y >= 0 && x < cv.w && y < cv.h && src[y * cv.w + x] !== null;
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      if (!isOpaque(x, y)) continue;
      if (!isOpaque(x - 1, y) || !isOpaque(x + 1, y) || !isOpaque(x, y - 1) || !isOpaque(x, y + 1)) {
        cv.data[y * cv.w + x] = PALETTE.k;
      }
    }
  }
}

export function drawQuestionMark(phase) {
  const cv = createCanvas(C, C);
  const k = PALETTE.k;
  const oy = [0, -1, 0, -1][phase % 4];
  const ox = 21 + [0, 0, 1, 0][phase % 4];
  const y = 1 + oy;

  px(cv, ox + 2, y, k);
  px(cv, ox + 3, y, k);
  px(cv, ox + 1, y + 1, k);
  px(cv, ox + 4, y + 1, k);
  px(cv, ox, y + 2, k);
  px(cv, ox + 5, y + 2, k);
  px(cv, ox + 4, y + 3, k);
  px(cv, ox + 4, y + 4, k);
  px(cv, ox + 4, y + 6, k);
  return cv;
}
