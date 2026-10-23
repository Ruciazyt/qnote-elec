/**
 * 像素猫 —— 程序化绘制
 *
 * 不用手写字符网格（容易混入空格/长度不齐的笔误），
 * 而是用椭圆/矩形/三角形等图元在 32x32 网格上落点。
 * 每个图元都按整数坐标绘制，因此输出必然是硬边像素，不会有抗锯齿。
 *
 * 坐标系：x 向右，y 向下，原点在画布左上角。
 * 猫坐在画面中下部：头顶约 y=7，底座约 y=29。
 */

import { createCanvas, px, PALETTE } from './pet.mjs';

const C = 32;

/** 填充实心椭圆（按像素中心点判定，无抗锯齿） */
function ellipse(cv, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) px(cv, x, y, color);
    }
  }
}

/** 填充椭圆环（描边用） */
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

/** 填充矩形 */
function box(cv, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) px(cv, x + dx, y + dy, color);
}

/** 绘制三角形（耳尖），顶点坐标 */
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

/**
 * 画一只完整的猫
 * @param {object} opt
 * @param {number} opt.bobY     身体垂直偏移（呼吸/压低）
 * @param {number} opt.tailPhase 尾巴摆动相位 0..3
 * @param {boolean} opt.blink    是否闭眼
 * @param {boolean} opt.squint   是否眯眼（思考态）
 */
export function drawCat(opt = {}) {
  const { bobY = 0, tailPhase = 0, blink = false, squint = false } = opt;
  const cv = createCanvas(C, C);
  const y = bobY;

  // ---- 尾巴（在身体之后画，先画以免盖住身体）----
  // 六相摆动：从右下伸出，绕根部做钟摆运动。
  // 摆幅需 >=3px，否则在 32px 网格上肉眼分辨不出，等于没动。
  const tailPos = [
    [[28, 24 + y], [30, 22 + y], [31, 19 + y], [31, 16 + y]],
    [[28, 24 + y], [30, 23 + y], [31, 21 + y], [30, 18 + y]],
    [[28, 24 + y], [29, 22 + y], [29, 19 + y], [27, 17 + y]],
    [[28, 24 + y], [27, 22 + y], [26, 19 + y], [26, 16 + y]],
    [[28, 24 + y], [27, 23 + y], [26, 21 + y], [25, 18 + y]],
    [[28, 24 + y], [28, 22 + y], [27, 19 + y], [27, 17 + y]],
  ][tailPhase % 6];
  // 先画粗一档的尾巴保证连通，再在上面叠细的主体
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
  // 尾尖加深，作为摆动的视觉锚点
  const [tx, ty] = tailPos[tailPos.length - 1];
  px(cv, tx, ty, PALETTE.l);
  px(cv, tx, ty + 1, PALETTE.s);

  // ---- 身体（坐姿：上窄下宽的椭圆）----
  ellipse(cv, 16, 23 + y, 8, 6.5, PALETTE.f);
  // 肚皮奶油色
  ellipse(cv, 16, 25 + y, 4.5, 4, PALETTE.c);
  // 前爪
  ellipse(cv, 12, 28.5 + y, 2.5, 1.5, PALETTE.c);
  ellipse(cv, 20, 28.5 + y, 2.5, 1.5, PALETTE.c);
  // 肉垫
  px(cv, 11, 29 + y, PALETTE.p);
  px(cv, 13, 29 + y, PALETTE.p);
  px(cv, 19, 29 + y, PALETTE.p);
  px(cv, 21, 29 + y, PALETTE.p);

  // ---- 耳朵（三角，在头之前画）----
  triangle(cv, 8, 11 + y, 12, 4 + y, 15, 12 + y, PALETTE.f); // 左耳
  triangle(cv, 17, 12 + y, 20, 4 + y, 24, 11 + y, PALETTE.f); // 右耳
  triangle(cv, 10, 10 + y, 12, 6 + y, 14, 11 + y, PALETTE.p); // 左耳内
  triangle(cv, 18, 11 + y, 20, 6 + y, 22, 10 + y, PALETTE.p); // 右耳内

  // ---- 头 ----
  ellipse(cv, 16, 14 + y, 9, 7.5, PALETTE.f);
  // 口鼻区（奶油色）
  ellipse(cv, 16, 17 + y, 5, 3, PALETTE.c);

  // ---- 描边：先勾外轮廓，五官画在描边之上，避免五官被描边糊掉 ----
  outline(cv);

  // ---- 眼睛 ----
  if (blink) {
    // 闭眼：一条向下弯的短线
    box(cv, 11, 14 + y, 4, 1, PALETTE.k);
    box(cv, 18, 14 + y, 4, 1, PALETTE.k);
  } else if (squint) {
    // 眯眼：只露出下缘一条
    box(cv, 12, 14 + y, 2, 1, PALETTE.k);
    box(cv, 19, 14 + y, 2, 1, PALETTE.k);
  } else {
    // 睁眼：深色眼眶 + 眼白 + 瞳孔 + 高光
    // 眼睛要画得够大够深，否则在 32px 网格上会被描边糊成一团白
    box(cv, 10, 11 + y, 5, 5, PALETTE.k);
    box(cv, 17, 11 + y, 5, 5, PALETTE.k);
    box(cv, 11, 12 + y, 3, 3, PALETTE.w);
    box(cv, 18, 12 + y, 3, 3, PALETTE.w);
    box(cv, 12, 13 + y, 2, 3, PALETTE.e);
    box(cv, 19, 13 + y, 2, 3, PALETTE.e);
    px(cv, 11, 12 + y, [0xff, 0xff, 0xff]); // 左眼高光
    px(cv, 18, 12 + y, [0xff, 0xff, 0xff]); // 右眼高光
  }

  // ---- 鼻子 + 嘴 ----
  px(cv, 15, 16 + y, PALETTE.p);
  px(cv, 16, 16 + y, PALETTE.p);
  box(cv, 16, 17 + y, 1, 1, PALETTE.k);
  px(cv, 15, 18 + y, PALETTE.k);
  px(cv, 17, 18 + y, PALETTE.k);

  // ---- 胡须 ----
  // 收短并内收：像素画里 3px 长的胡须脱离身体后会读成一根杂线，
  // 只有紧贴脸颊的短须才有"胡须"的语义
  box(cv, 8, 16 + y, 2, 1, PALETTE.k);
  box(cv, 8, 18 + y, 1, 1, PALETTE.k);
  box(cv, 23, 16 + y, 2, 1, PALETTE.k);
  box(cv, 24, 18 + y, 1, 1, PALETTE.k);

  // ---- 头顶斑纹（画在描边之后，保持清晰）----
  box(cv, 14, 7 + y, 1, 2, PALETTE.s);
  box(cv, 17, 7 + y, 1, 2, PALETTE.s);

  return cv;
}

/**
 * 统一描边 —— 找出所有不透明像素的四邻，若邻位透明则涂描边色
 * 这样轮廓干净，不会出现零散断点
 */
function outline(cv) {
  const src = cv.data.slice();
  const isOpaque = (x, y) => x >= 0 && y >= 0 && x < cv.w && y < cv.h && src[y * cv.w + x] !== null;
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      if (!isOpaque(x, y)) continue;
      // 只给"外轮廓"描边：若该像素的四邻中存在透明，才涂描边色。
      // 五官（眼白/瞳孔）必须画在这之后，否则内部颜色会被判成边缘而糊掉。
      if (!isOpaque(x - 1, y) || !isOpaque(x + 1, y) || !isOpaque(x, y - 1) || !isOpaque(x, y + 1)) {
        cv.data[y * cv.w + x] = PALETTE.k;
      }
    }
  }
}

/**
 * 思考状态的问号浮层
 * 放在头顶正上方偏右，与猫头对齐
 * @param {number} phase 0..3，决定问号的高度与闪烁
 */
export function drawQuestionMark(phase) {
  const cv = createCanvas(C, C);
  const k = PALETTE.k;
  const oy = [0, -1, 0, -1][phase % 4]; // 上下微浮动
  const ox = 21 + [0, 0, 1, 0][phase % 4];
  const y = 1 + oy;

  // 问号钩
  px(cv, ox + 2, y, k);
  px(cv, ox + 3, y, k);
  px(cv, ox + 1, y + 1, k);
  px(cv, ox + 4, y + 1, k);
  px(cv, ox, y + 2, k);
  px(cv, ox + 5, y + 2, k);
  px(cv, ox + 4, y + 3, k);
  px(cv, ox + 4, y + 4, k);
  // 点
  px(cv, ox + 4, y + 6, k);
  return cv;
}
