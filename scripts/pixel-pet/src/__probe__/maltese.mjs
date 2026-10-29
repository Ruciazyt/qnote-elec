/**
 * 马尔济斯犬（Maltese）—— 程序化绘制
 *
 * 与橘猫的画法差异（这些是白色长毛犬的关键，不是风格偏好）：
 *
 * 1. 纯白在浅色背景上不可见。必须靠「内部阴影」而不是描边来表现体积，
 *    且主白要比 #FFFFFF 略暗（暖白），否则纯白在白底上会整个消失。
 *    判定标准：把预览图放到白底上，轮廓还能读出来才算过。
 *
 * 2. 垂耳不是立耳。马尔济斯的耳朵长而圆、垂在头两侧，是品种特征，
 *    画成立耳会变成别的品种。耳朵要先画（压在头下面）。
 *
 * 3. 描边用暖深灰而非纯黑。纯黑描边配白毛会显得生硬，
 *    暖深灰 #4A443E 更接近真实长毛的阴影色。
 *
 * 坐标系：x 向右，y 向下，原点画布左上角。网格 32x32。
 */

import { createCanvas, px, shift, PALETTE as _BASE } from './pet.mjs';

const C = 32;

/** 马尔济斯专用调色板（限定 7 色，白犬靠明度层次而非色相取胜） */
export const PALETTE = {
  '.': null, // 透明
  k: [0x4a, 0x44, 0x3e], // 描边 / 五官 暖深灰
  w: [0xf7, 0xf4, 0xef], // 主毛 暖白（比纯白略暗，保证浅底可见）
  s: [0xd8, 0xd2, 0xc8], // 阴影 暖灰
  d: [0xb4, 0xac, 0x9e], // 深阴影 耳内 / 发缝
  e: [0x2a, 0x25, 0x20], // 眼睛 / 鼻子 近黑
  p: [0xf5, 0xa9, 0xb8], // 舌头 / 肉垫 淡粉
  /**
   * 披风 —— 全身唯一的彩色块
   *
   * 用深暖红棕而非浅色，是为了让披风与白毛形成明确分界。
   * 若披风也用 `s`/`d` 这类浅灰，它会和身体阴影混成一片，
   * 在 32px 网格上根本分不出"这是披风还是身体"。
   * 深色 + 有彩色 = 小尺寸下最容易被识别的部件。
   */
  c: [0x8c, 0x4a, 0x3a], // 披风 深红棕
  m: [0xa8, 0x5f, 0x4a], // 披风亮部（褶皱高光）
};

/* ------------------------------------------------------------------ */
/* 图元                                                                */
/* ------------------------------------------------------------------ */

/** 实心椭圆（按像素中心点判定，硬边无抗锯齿） */
function ellipse(cv, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) px(cv, x, y, color);
    }
  }
}

/** 矩形 */
function box(cv, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) px(cv, x + dx, y + dy, color);
}

/** 三角形（发梢、耳尖） */
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
 * 连线（Bresenham），用于颈毛分缕与尾巴
 *
 * 坐标会先取整。这一点是必须的：Bresenham 的终止条件是 `x===x2 && y===y2`，
 * 而浮点坐标下步进会**跳过**终点（21.5 → 22.5 → 23.5，永远到不了 23），
 * 导致死循环。像素画本来也只能画整数像素，取整语义上也是对的。
 * 另外加了步数上限作为兜底，避免任何算法失误再次挂死生成脚本。
 */
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
  // 上限：画布对角线的 2 倍，足够走完任何一条合法线段
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

/**
 * 外轮廓描边 —— 四邻存在透明像素时涂描边色
 *
 * 顺序要求：必须画在五官之前。跑在之后会把眼白、瞳孔等内部颜色
 * 一并判成边缘涂黑，眼睛糊成一团。
 */
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

/* ------------------------------------------------------------------ */
/* 角色                                                                */
/* ------------------------------------------------------------------ */

/**
 * 画一只马尔济斯犬
 * @param {object} opt
 * @param {number}  opt.bobY      身体垂直位移（呼吸 / 思考时低头）
 * @param {number}  opt.capePhase 披风飘动相位 0..5
 * @param {boolean} opt.blink     是否闭眼
 * @param {boolean} opt.squint    是否眯眼（思考态）
 */
/**
 * 姿态 —— 在同一套身体结构上替换**局部**几何，而不是画第二只狗
 *
 * 姿态表默认只允许改一到两个部件。每多改一个部位，就多一次把角色改坏的机会：
 * 32px 粗网格上几乎没有余量，一个部位的形变很容易从相邻部位"借"到像素，
 * 把比例、辨识特征一起赔进去。头顶毛 / 头 / 吻部 / 围巾围带属于
 * 马尔济斯的辨识点，任何姿态都不得改动。
 *
 * - drag（悬空拖拽）：只把垂耳拉长下垂，模拟耳朵被拎起时受重力拉直。
 * - null（默认坐姿）：原地不动的默认状态。
 */
export const POSES = {
  /**
   * 拖拽姿态：**只改耳朵，其余几何全部沿用坐姿**
   *
   * 试过把眼睛撑大、把腿改成外张的细棍、身体收窄，结果三个部位全是败笔：
   * - 眼睛在 32px 粗网格上撑到 2.3×2.6 渲染不成圆形，顶边被描边啃成锯齿；
   * - 两段椭圆串出的斜腿成了一根细棍加一个圆点，像骨头不像腿；
   * - 身体一收窄头身比直接崩掉。
   *
   * 所以姿态差异只保留耳朵这一处 —— 垂耳被拎起来时重力会把它拉长，
   * 这是唯一在 32px 上既能表达受力、又不破坏角色比例的部位。
   * 眼睛、腿、身体、围巾全部保持坐姿原样，拖拽的动感交给整体摆动去做。
   *
   * 校验方式：取 `bobY/capePhase/swayX` 与 idle 首帧完全相同的 drag 帧
   * 做逐像素比对，差异应**只出现在耳朵所在的列区间**，
   * 眼、腿、身体、围巾区域必须零差异。改动姿态后重跑这条校验。
   */
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

  // ---- 垂耳（品种特征：长、圆、垂在头两侧）----
  // 先画耳朵，随后头部会盖住耳根，形成"垂在肩后"的层次
  const EAR = pose?.ear;
  ellipse(cv, 8.5, (EAR?.cy ?? 15.5) + y, EAR?.rx ?? 2.8, EAR?.ry ?? 5.2, PALETTE.w);
  ellipse(cv, 23.5, (EAR?.cy ?? 15.5) + y, EAR?.rx ?? 2.8, EAR?.ry ?? 5.2, PALETTE.w);
  // 耳内侧深阴影 —— 白犬的体积全靠这个
  ellipse(cv, 9.8, (EAR?.innerCy ?? 16.5) + y, 1.4, (EAR?.ry ?? 5.2) - 1.6, PALETTE.d);
  ellipse(cv, 22.2, (EAR?.innerCy ?? 16.5) + y, 1.4, (EAR?.ry ?? 5.2) - 1.6, PALETTE.d);

  // ---- 身体（坐姿，小巧）----
  ellipse(cv, 16, 24.5 + y, 6.8, 4.6, PALETTE.w);
  // 身体下缘阴影：白犬不画阴影就完全没有立体感
  ellipse(cv, 15.5, 26.5 + y, 5.4, 2.6, PALETTE.s);

  // ---- 前腿与爪 ----
  ellipse(cv, 12.8, 28.5 + y, 2.0, 1.6, PALETTE.w);
  ellipse(cv, 19.2, 28.5 + y, 2.0, 1.6, PALETTE.w);
  ellipse(cv, 12.8, 29.5 + y, 1.4, 0.9, PALETTE.s);
  ellipse(cv, 19.2, 29.5 + y, 1.4, 0.9, PALETTE.s);

  // ---- 披风 / 围巾 ----
  //
  // 画在身体与前爪**之上**、头部**之下**。遮挡关系本身就是语义：
  // 压在身体上 = 穿戴物，画在身体下面 = 身体后面长出来的东西（= 尾巴）。
  //
  // 读作"披风/围巾"需要三个要素同时成立，缺一个就退回尾巴：
  //
  // 1. **一条横跨脖子的完整横带**。尾巴不会横跨，这是与肢体最硬的区分。
  // 2. **一侧下垂片**，有独立于身体的摆动。
  // 3. **每个方向厚度 >= 5px（含描边）**。描边吃两侧各 1px：
  //    2px → 剩 0px（全被吃光）、3px → 剩 1px（勉强）、
  //    5px → 剩 3px（可读）。这是"细部件消失"的通用阈值，
  //    与线宽无关，只与描边宽度有关。
  //
  // 另外用有彩色（深红棕 c）而非白/灰：白披风贴在白狗身上完全分不开，
  // 而浅灰会和身体阴影 `s` 混成一片。
  //
  // 比例上刻意让**垂片比围带更长**。两者一样长时，围带会把上半身整块盖住，
  // 角色读成"穿红毛衣的狗"而不是"戴围巾的狗"；垂片拉长后红色重心外移，
  // 胸腹的白毛留出来，"布料在身侧飘"的语义才立得住。

  // 颈部围带：四行的圆角块（上窄下宽），不是死板矩形
  // 顶行只取 9px，正好落在下巴（y=19 实心区间 x=14..18）的宽度内 ——
  // 顶行比下巴宽的话，多出来的部分上邻透明，会整排被判成描边，
  // 和下巴自身的暗色连成一条黑杠，围巾看起来像戴了个项圈而不是围在脖子上。
  const COLLAR_W = [9, 11, 11, 9];
  for (let row = 20; row <= 23; row++) {
    const w = COLLAR_W[row - 20];
    const x1 = 16 - ((w - 1) >> 1);
    for (let k = 0; k < w; k++) px(cv, x1 + k, row + y, PALETTE.c);
  }
  // 围带受光的一行：给出布料圆弧感，也是唯一让色块不至于死板的地方
  for (let x = 13; x <= 19; x++) px(cv, x, 21 + y, PALETTE.m);

  // 右侧下垂片：整帧唯一会动的披风部件
  // 只动下垂片、不动横带 —— 横带一飘，脖子看起来像在晃，角色会散掉。
  const DRAPE = [
    { len: 6, tilt: 0 },
    { len: 7, tilt: 0 },
    { len: 8, tilt: 1 },
    { len: 9, tilt: 1 },
    { len: 8, tilt: 0 },
    { len: 7, tilt: -1 },
  ][capePhase % 6];
  const D0 = 22; // 左缘，5 列宽 → 描边后可见 3 列
  const DRAPE_H = Math.max(1, DRAPE.len - 1);
  for (let r = 0; r < DRAPE.len; r++) {
    const off = Math.round((DRAPE.tilt * r) / DRAPE_H);
    for (let k = 0; k < 5; k++) px(cv, D0 + off + k, 21 + r + y, PALETTE.c);
    // 靠近身体一侧的褶皱亮部；末两行留暗，读作下摆转折
    if (r < DRAPE.len - 2) px(cv, D0 + off + 1, 21 + r + y, PALETTE.m);
  }

  // ---- 头顶长毛（马尔济斯的标志：直发、中分、向两侧垂）----
  // 宽度必须明显小于脸：顶毛一旦和脸同宽，角色会读成狮子玩偶而不是犬。
  ellipse(cv, 16, 9.5 + y, 4.6, 2.6, PALETTE.w);
  ellipse(cv, 11.0, 11 + y, 2.4, 2.2, PALETTE.w); // 左鬓
  ellipse(cv, 21.0, 11 + y, 2.4, 2.2, PALETTE.w); // 右鬓
  // 中分发缝 + 发梢阴影
  line(cv, 16, 7 + y, 16, 10 + y, PALETTE.d);
  triangle(cv, 9, 13 + y, 11, 13 + y, 9.5, 15 + y, PALETTE.s); // 左发梢
  triangle(cv, 23, 13 + y, 21, 13 + y, 22.5, 15 + y, PALETTE.s); // 右发梢

  // ---- 头 ----
  // 略窄于身高：马尔济斯是小型犬，头脸要秀气。
  // 脸过宽会读成熊或狮子，吻部必须前突以保证犬科轮廓。
  ellipse(cv, 16, 14.5 + y, 5.6, 5.2, PALETTE.w);
  // 吻部：向前下方伸出的白色锥形，犬科的必要结构
  ellipse(cv, 16, 17.5 + y, 3.0, 2.4, PALETTE.w);
  // 脸颊阴影，柔化脸型
  ellipse(cv, 11.8, 16.8 + y, 1.8, 2.0, PALETTE.s);
  ellipse(cv, 20.2, 16.8 + y, 1.8, 2.0, PALETTE.s);

  // ---- 描边：必须在五官之前 ----
  outline(cv);

  // ---- 五官 ----
  // 马尔济斯眼黑而圆，这是它最显著的辨识点
  if (blink) {
    line(cv, 11, 13 + y, 14, 13 + y, PALETTE.e);
    line(cv, 18, 13 + y, 21, 13 + y, PALETTE.e);
  } else if (squint) {
    // 眯眼：**上睑一行 + 白缝 + 眼缝一行**
    //
    // 原来是 `ellipse(12.8, 14.2, 2.0, 1.0)` 画出来的一个压扁暗块：
    // 上排 4px、下排 2px，两排直接相邻。这个形状的问题不是"太胖"，
    // 而是**没有内部结构** —— 观者会把上排读成眉、下排读成眼，
    // 而它们贴在一起就成了"眉眼糊成一块"。加粗或上移都不解决这个。
    //
    // 拆成两行、中间留 1px 白，那道白缝就是眉与眼的物理分界。
    // 两行都刻意画窄并偏内（不是满宽），否则两条等宽横杠又会读成蒙面绷带。
    //
    // 位置比原来上移 2px：眼缝到鼻头之间空出 2px 白，
    // 眼睛 / 眉 / 鼻三块暗色彻底断开。
    for (let x = 12; x <= 14; x++) px(cv, x, 12 + y, PALETTE.e); // 上睑
    for (let x = 18; x <= 20; x++) px(cv, x, 12 + y, PALETTE.e);
    for (let x = 12; x <= 13; x++) px(cv, x, 14 + y, PALETTE.e); // 眼缝
    for (let x = 19; x <= 20; x++) px(cv, x, 14 + y, PALETTE.e);
  } else {
    // 马尔济斯眼黑而圆，是它最显著的辨识点。
    // 白毛上必须画得够大够深，2px 的眼睛在 64px 显示下会直接消失。
    //
    // **不要为了表达情绪而放大眼睛。** 试过撑到 2.3×2.6：
    // 32px 网格分辨率不出这个尺寸的圆形，顶边会被描边啃成锯齿，
    // 出来是两坨不规则的怪块。情绪靠眼态分支（睁/闭/眯）切换，不靠放大。
    ellipse(cv, 12.8, 13 + y, 2.0, 2.2, PALETTE.e);
    ellipse(cv, 19.2, 13 + y, 2.0, 2.2, PALETTE.e);
    // 高光：用主白保持调性统一，并让眼睛有神
    px(cv, 12, 12 + y, PALETTE.w);
    px(cv, 18, 12 + y, PALETTE.w);
  }

  // 鼻头：黑、圆、位于吻部最前端，是马尔济斯最强的辨识点
  ellipse(cv, 16, 18 + y, 1.6, 1.3, PALETTE.e);
  // 吻部下方的小 w 形，仅用两点示意。
  //
  // **所有姿态都只能用它这一种嘴，不做"张嘴"变体**：
  // 吻部底在 y=19、围巾围带顶在 y=20，中间没有空行。
  // 张嘴的椭圆必然落在围巾上，把围带中间戳穿并与鼻头连成一整块黑，
  // 反而把"惊讶"变成"一团黑"。表情靠眼态分支切换，嘴始终保持闭合。
  px(cv, 15, 19 + y, PALETTE.k);
  px(cv, 17, 19 + y, PALETTE.k);

  // 整体水平摆动（拖拽时被拎着晃）。
  // 放在最后统一平移，而不是给每个图元加偏移 —— 后者会让所有坐标都带上 swayX，
  // 改一处漏一处很难发现。
  const swayX = opt.swayX ?? 0;
  return swayX ? shift(cv, swayX, 0) : cv;
}

/**
 * 思考状态的问号浮层
 *
 * 已上移到 pet.mjs —— 它是通用浮层而非马尔济斯特征，
 * 从图片转换的生成器（from-image.mjs）也要用同一份形状。
 * 这里转出去只是为了让 build.mjs 现有的导入路径不用改。
 */
export { drawQuestionMark } from './pet.mjs';
