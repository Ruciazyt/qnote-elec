/**
 * 像素宠物 —— 确定性生成器
 *
 * 全部像素由代码画出，不经过任何生图模型。
 * 原因：像素画最常见的失败不是"画得丑"，而是模型返回
 * 「看起来像像素画的插画」——带抗锯齿的软边、落在任意网格上、
 * 尺寸不对。这类图无法通过后处理可靠修复，只能重画。
 * 用代码画则每个像素都可控，且改一个参数就能重出一整套帧。
 *
 * 网格：32x32 像素单元格。
 * 缩放：宠物以整数倍放大渲染（见 SCALE），避免非整数缩放产生半像素糊边。
 */

/** 调色板。限定色数是像素画的硬约束，不是风格偏好。 */
export const PALETTE = {
  '.': null, // 透明
  k: [0x2b, 0x2b, 0x33], // 描边 深炭
  f: [0xf2, 0xa6, 0x5a], // 毛色 橘
  s: [0xd9, 0x8a, 0x3d], // 毛色暗部
  l: [0xff, 0xc9, 0x8a], // 毛色亮部
  c: [0xff, 0xf0, 0xd9], // 肚皮/口鼻 奶油
  w: [0xff, 0xff, 0xff], // 眼白
  p: [0xff, 0x9e, 0xae], // 鼻子/耳内/肉垫 粉
  e: [0x3a, 0x3a, 0x44], // 瞳孔
};

/** 单元格边长（像素） */
export const CELL = 32;

/** 渲染放大倍数。必须是整数，且 SCALE * CELL 应接近目标视觉尺寸。 */
export const SCALE = 2;

/** 动画定义 —— 帧数、节奏集中在这里，改这里就能调整动作密度 */
export const ANIMATIONS = {
  idle: {
    // 待机：6 帧。呼吸起伏 2px + 围巾垂片六相摆动 + 一次眨眼
    // 2.5fps 下 6 帧 = 2.4s 一个循环，符合"待机要慢"的手感
    frames: 6,
    fps: 2.5,
    desc: '待机呼吸：身体上下起伏，围巾垂片六相摆动，第 5 帧眨眼',
  },
  thinking: {
    // 思考：8 帧。身体压低 + 问号闪烁 + 围巾急摆 + 眯眼
    // 6fps 下 8 帧 ≈ 1.3s，比待机明显更急，状态差异一眼可辨
    frames: 8,
    fps: 6,
    desc: '思考中：身体压低 2px，头顶问号闪烁，围巾急摆，眼睛眯起',
  },
  drag: {
    // 拖拽：8 帧。整只钟摆式左右摆，耳朵与前腿垂下，眼睛睁圆嘴微张
    //
    // 帧数必须是 8：钟摆偏移 [+2,+1,0,-1,-2,-1,0,+1] 的首尾差是 1px，
    // 循环接缝才看不出来。6 帧会让 -1 直接跳回 +2，摆动像卡了一下。
    frames: 8,
    fps: 6,
    desc: '被拖拽中：身体钟摆式左右晃，垂耳拉长，前腿悬空下垂，睁圆眼微张嘴',
  },
};

/** 创建一块全透明的画布 */
export function createCanvas(w = CELL, h = CELL) {
  return { w, h, data: new Array(w * h).fill(null) };
}

/** 在画布上填一个矩形 */
export function rect(cv, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      px(cv, x + dx, y + dy, color);
    }
  }
}

/** 写单个像素（越界忽略） */
export function px(cv, x, y, color) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  cv.data[y * cv.w + x] = color;
}

/** 读单个像素 */
export function get(cv, x, y) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return null;
  return cv.data[y * cv.w + x];
}

/**
 * 把另一块画布叠加上来（src 透明处不覆盖）
 * 原地修改 dst 并返回它，方便链式赋值
 *
 * 注意是**原地**：调用方必须保证 dst 可以被改写。
 * 拿一个共享的基准帧来 overlay，浮层就会永久烧进基准帧，
 * 后续所有引用它的帧都会带上这个东西 —— 表现是「某个状态的装饰出现在别的状态上」，
 * 不报错、也很难一眼看出来是哪一步污染的。需要保留原图就自己先 clone。
 */
export function overlay(dst, src, ox = 0, oy = 0) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const c = src.data[y * src.w + x];
      if (c) px(dst, x + ox, y + oy, c);
    }
  }
  return dst;
}

/** 复制一块画布（overlay 会原地改画布，派生新帧前必须先复制） */
export function clone(cv) {
  return { w: cv.w, h: cv.h, data: cv.data.slice() };
}

/** 把画布整体上下平移（底部保持不动，用于呼吸） */
export function shiftUp(cv, dy) {
  return shift(cv, 0, dy);
}

/**
 * 绕垂直中线剪切，做出「被拎着晃」的倾斜
 *
 * 与 shift 的区别：shift 是整块刚体平移，轮廓形状不变；
 * 这里每一行按离中线的距离偏移，轮廓会真的歪掉，钟摆感才出得来。
 * 只做刚体平移的拖拽帧看起来像贴图在滑动，不像被拎起来晃。
 *
 * @param rows 倾斜强度。为 ±2 时画布上下端各偏 2px，中间不动。
 */
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

/**
 * 思考状态的问号浮层，放在头顶右上方
 *
 * 放在 pet.mjs 而不是某个角色模块里：它不是某个品种的特征，
 * 两套生成器（程序化 / 图片转换）必须用同一份形状，
 * 各自画一份早晚会长得不一样。
 *
 * @param phase 0..3 相位，自带上下左右微抖，避免死板地原地闪
 */
export function drawQuestionMark(phase) {
  const cv = createCanvas(CELL, CELL);
  const k = PALETTE.k;
  const p = phase % 4;
  const ox = 22 + [0, 0, 1, 0][p];
  // y 最低取 1 而不取 0：贴到格子顶边会被生成器的贴边检查报成警，
  // 而这个浮层压线本来是允许的，为了不让真问题被噪声淹没就留出一行
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

/**
 * 把画布整体平移（dx 向右、dy 向下为正）
 *
 * 与 shiftUp 的区别：shiftUp 是"底部固定"的特殊语义，
 * 这里返回新画布，越界部分直接丢弃。
 */
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
