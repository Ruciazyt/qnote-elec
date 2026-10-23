/**
 * 打包器 —— 把各动画帧合成一张横向 spritesheet，并输出 PNG
 *
 * 不依赖任何图像库：PNG 用 Node 内置 zlib 手写编码。
 * 这样脚本在任意机器上都能跑，不需要 npm install。
 *
 * PNG 编解码与产物写出已抽到 png.mjs / pack.mjs，
 * 与 from-image.mjs（从图片转换）共用同一套实现，保证两边产物同构。
 */

import fs from 'node:fs';
import path from 'node:path';
import { CELL, SCALE, ANIMATIONS, createCanvas, overlay } from './pet.mjs';
import { writeOutputs } from './pack.mjs';
import { drawMaltese, drawQuestionMark } from './maltese.mjs';

/**
 * 当前使用的角色
 * 换成别的角色只需替换这一行的导入，例如：
 *   import { drawCat, drawQuestionMark } from './cat.mjs';
 * 前提是该模块导出同名函数签名 —— 保持接口一致即可无痛切换。
 *
 * 注意：当前实际使用的是 from-image.mjs（源图 assets/scarf-dog.png），
 * 这个程序化生成器保留作为回退方案，见 README「两套生成器」。
 */
const drawCharacter = drawMaltese;

/**
 * 仓库根目录 —— 输出目录必须落在这个范围之内
 *
 * argv[2] 是命令行给的输出目录，不校验就等于允许写到仓库外。
 */
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..');

/* ------------------------------------------------------------------ */
/* 动画定义                                                            */
/* ------------------------------------------------------------------ */

/**
 * 每个动画的具体帧配方
 * bobY      身体垂直位移（呼吸起伏）
 * capePhase 披风飘动相位（0..5 六相循环）
 * blink     闭眼
 * squint    眯眼（思考态）
 * mark      叠加问号的相位；undefined 表示不画
 *
 * 设计要点：
 * - idle 用 0/-1/0/1 的对称起伏，首尾帧 bobY 相同，循环才不会有跳变
 * - 披风相位要走完整一轮 0→1→2→3→4→5→0，避免循环点处披风瞬移
 * - 眨眼只出现在单帧上，且安排在起伏回落处，看起来像自然的眨眼节奏
 */
const RECIPES = {
  idle: [
    { bobY: 0, capePhase: 0 },
    { bobY: -1, capePhase: 1 },
    { bobY: -1, capePhase: 2 },
    { bobY: 0, capePhase: 3 },
    { bobY: 1, capePhase: 4 },
    { bobY: 0, capePhase: 5, blink: true },
  ],
  thinking: [
    { bobY: 1, capePhase: 5, squint: true, mark: 0 },
    { bobY: 2, capePhase: 4, squint: true, mark: 1 },
    { bobY: 1, capePhase: 3, squint: true, mark: 2 },
    { bobY: 2, capePhase: 2, squint: false, mark: 3 },
    { bobY: 1, capePhase: 3, squint: true, mark: 2 },
    { bobY: 2, capePhase: 1, squint: true, mark: 1 },
    { bobY: 1, capePhase: 0, squint: false, mark: 0 },
    { bobY: 2, capePhase: 5, squint: true, mark: 3 },
  ],
  drag: [
    // 钟摆：首帧 +2、末帧 +1，循环接缝只差 1px，看不出跳变
    // 围巾相位走 0→5→0→1 的两段，每一段内部都是相邻相位，衔接处也不跳
    { pose: 'drag', swayX: 2, bobY: 0, capePhase: 0 },
    { pose: 'drag', swayX: 1, bobY: 0, capePhase: 1 },
    { pose: 'drag', swayX: 0, bobY: 1, capePhase: 2 },
    { pose: 'drag', swayX: -1, bobY: 0, capePhase: 3 },
    { pose: 'drag', swayX: -2, bobY: 0, capePhase: 4 },
    { pose: 'drag', swayX: -1, bobY: -1, capePhase: 5 },
    { pose: 'drag', swayX: 0, bobY: 0, capePhase: 0 },
    { pose: 'drag', swayX: 1, bobY: 0, capePhase: 1 },
  ],
};

function buildFrame(anim, index) {
  const recipe = RECIPES[anim][index % RECIPES[anim].length];
  let cv = drawCharacter(recipe);
  if (recipe.mark !== undefined) {
    cv = overlay(cv, drawQuestionMark(recipe.mark));
  }
  return cv;
}

function main() {
  const outDir = path.resolve(
    process.argv[2] || path.resolve(import.meta.dirname, '../../../src/renderer/public/pixel-pet')
  );

  // 输出目录先校验再往下走：越界就直接退出，
  // 免得白跑一遍帧渲染才发现目录不能用。
  const rel = path.relative(PROJECT_ROOT, outDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(`❌ 输出目录必须位于仓库根目录之内: ${process.argv[2]}`);
    console.error(`   仓库根目录: ${PROJECT_ROOT}`);
    process.exit(1);
  }

  const rows = [];
  for (const [anim, cfg] of Object.entries(ANIMATIONS)) {
    rows.push({
      anim,
      cfg,
      frames: Array.from({ length: cfg.frames }, (_, i) => buildFrame(anim, i)),
    });
  }

  const { sheet, preview, total, meta } = writeOutputs(rows, outDir);

  console.log('spritesheet:', `${sheet.w}x${sheet.h}`, `(${total} frames)`);
  for (const [anim, m] of Object.entries(meta.animations)) {
    console.log(`  ${anim}: start=${m.start} frames=${m.frames} fps=${m.fps}`);
  }
  console.log('preview:', `${preview.w}x${preview.h}`);
}

// CELL / SCALE 在这里被引用一次，是为了让"改了 pet.mjs 的格子尺寸"这件事
// 在本文件里也留下痕迹，避免只改了 pet.mjs 却忘了图集尺寸要跟着变。
void CELL;
void SCALE;
void createCanvas;
void fs;

main();
