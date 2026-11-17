
import fs from 'node:fs';
import path from 'node:path';
import { CELL, SCALE, ANIMATIONS, createCanvas, overlay } from './pet.mjs';
import { writeOutputs } from './pack.mjs';
import { drawMaltese, drawQuestionMark } from './maltese.mjs';

const drawCharacter = drawMaltese;

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..');


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

void CELL;
void SCALE;
void createCanvas;
void fs;

main();
