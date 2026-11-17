
export const PALETTE = {
  '.': null,
  k: [0x2b, 0x2b, 0x33],
  f: [0xf2, 0xa6, 0x5a],
  s: [0xd9, 0x8a, 0x3d],
  l: [0xff, 0xc9, 0x8a],
  c: [0xff, 0xf0, 0xd9],
  w: [0xff, 0xff, 0xff],
  p: [0xff, 0x9e, 0xae],
  e: [0x3a, 0x3a, 0x44],
};

export const CELL = 32;

export const SCALE = 2;

export const ANIMATIONS = {
  idle: {
    frames: 6,
    fps: 2.5,
    desc: '待机呼吸：身体上下起伏，围巾垂片六相摆动，第 5 帧眨眼',
  },
  thinking: {
    frames: 8,
    fps: 6,
    desc: '思考中：身体压低 2px，头顶问号闪烁，围巾急摆，眼睛眯起',
  },
  drag: {
    frames: 8,
    fps: 6,
    desc: '被拖拽中：身体钟摆式左右晃，垂耳拉长，前腿悬空下垂，睁圆眼微张嘴',
  },
};

export function createCanvas(w = CELL, h = CELL) {
  return { w, h, data: new Array(w * h).fill(null) };
}

export function rect(cv, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      px(cv, x + dx, y + dy, color);
    }
  }
}

export function px(cv, x, y, color) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  cv.data[y * cv.w + x] = color;
}

export function get(cv, x, y) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return null;
  return cv.data[y * cv.w + x];
}

export function overlay(dst, src, ox = 0, oy = 0) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const c = src.data[y * src.w + x];
      if (c) px(dst, x + ox, y + oy, c);
    }
  }
  return dst;
}

export function clone(cv) {
  return { w: cv.w, h: cv.h, data: cv.data.slice() };
}

export function shiftUp(cv, dy) {
  return shift(cv, 0, dy);
}

export function tilt(cv, rows) {
  if (!rows) return cv;
  const out = createCanvas(cv.w, cv.h);
  const pivot = (cv.h - 1) / 2;
  for (let y = 0; y < cv.h; y++) {
    const dx = Math.round(((y - pivot) * rows * 2) / (cv.h - 1));
    for (let x = 0; x < cv.w; x++) {
      const c = cv.data[y * cv.w + x];
      if (c) px(out, x + dx, y, c);
    }
  }
  return out;
}

export function drawQuestionMark(phase) {
  const cv = createCanvas(CELL, CELL);
  const k = PALETTE.k;
  const p = phase % 4;
  const ox = 22 + [0, 0, 1, 0][p];
  const y = 2 + [0, -1, 0, -1][p];

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

export function shift(cv, dx, dy) {
  const out = createCanvas(cv.w, cv.h);
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const c = cv.data[y * cv.w + x];
      if (c) px(out, x + dx, y + dy, c);
    }
  }
  return out;
}
