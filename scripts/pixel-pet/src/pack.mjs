/**
 * 打包与产物写出 —— 所有角色生成器共用
 *
 * 抽出来的原因：程序化生成的 build.mjs 与从图片转换的 from-image.mjs
 * 产出的东西必须**完全同构**（同样的帧序、同样的预览图排布、同样写 pet.json），
 * 否则运行时（PixelPet.tsx 里的 ANIM_META）与磁盘上的资产会对不上，
 * 表现是动画横向平移而不是换帧 —— 这种 bug 不报错，只会觉得"图坏了"。
 */

import fs from 'node:fs';
import path from 'node:path';
import { CELL, SCALE, createCanvas, overlay } from './pet.mjs';
import { encodePng } from './png.mjs';

/** 把逻辑画布按整数倍放大成 RGBA 像素数组（最近邻，绝不插值） */
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

/**
 * 写出 spritesheet.png / pet.json / preview.png
 *
 * @param rows Array<{anim:string,cfg:{frames:number,fps:number,desc:string},frames:Array<Canvas>}>
 *             行内帧序即图集中的帧序，pet.json 的 start 必须与之一致
 * @param outDir 输出目录
 */
export function writeOutputs(rows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  // ---- 预览图 ----
  // 两行对照：
  //   上排 1:1（SCALE 倍）—— 这才是用户实际看到的尺寸，用于判断"真机是否清晰"
  //   下排 4 倍 —— 仅用于检查像素排布细节
  //
  // 为什么要两行：只在 4 倍下校验是像素画最常见的自欺。
  // 放大图上 1px 的眼白、浅阴影全都清晰可辨，但真实渲染只有 64px，
  // 这些细节会被邻接像素吞掉。**清晰度必须在真实尺寸上判定。**
  const GAP = 2;
  const ROWS_BIG = 4;
  const rowsTotal = rows.length * 2;
  const previewFrames = rows.flatMap((r) => r.frames);
  const pwSmall = previewFrames.length * CELL * SCALE + (previewFrames.length + 1) * GAP;
  const pwBig = previewFrames.length * CELL + (previewFrames.length + 1) * GAP;
  const pw = Math.max(pwSmall, pwBig) + CELL * ROWS_BIG + GAP * (rowsTotal + 1);
  const ph = rowsTotal * CELL * ROWS_BIG + (rowsTotal + 1) * GAP;
  const preview = createCanvas(pw, ph);
  // 棋盘格背景，便于看清透明区域
  // 底色用中性灰而非浅灰白：白毛角色在接近白色的底上会失去轮廓，
  // 无法判断"描边够不够"。中性灰对明、暗两种毛发都保持对比。
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      preview.data[y * pw + x] = checker ? [0x9a, 0x9a, 0xa0] : [0x7e, 0x7e, 0x86];
    }
  }

  // 上排：1:1 真实尺寸
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

  // 下排：4 倍细节
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
  fs.writeFileSync(path.join(outDir, 'preview.png'), encodePng(pr.data, pr.w, pr.h));

  // ---- 正式 spritesheet：所有动画横向排成一行 ----
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
  fs.writeFileSync(path.join(outDir, 'spritesheet.png'), encodePng(sr.data, sr.w, sr.h));

  // ---- 帧索引元数据：告诉组件每段动画在第几帧 ----
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
  fs.writeFileSync(path.join(outDir, 'pet.json'), JSON.stringify(meta, null, 2));

  return { sheet: sr, preview: pr, total, meta };
}
