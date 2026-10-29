// scripts/build/build-icon.mjs
// 从 src/renderer/public/icon.svg 生成多尺寸 PNG 和 .ico
// 用法：node scripts/build/build-icon.mjs
//
// 输出：
//   src/renderer/public/icon-16.png
//   src/renderer/public/icon-32.png
//   src/renderer/public/icon-48.png
//   src/renderer/public/icon-64.png
//   src/renderer/public/icon-128.png
//   src/renderer/public/icon-256.png
//   src/renderer/public/icon.ico       ← 16/32/48/64/128/256 多分辨率合集
//   resources/icon.ico                  ← 开发模式托盘/右键菜单用的图标

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
// 从 src/renderer 找 node_modules（pnpm 结构）
const RENDERER = path.join(import.meta.dirname, "..", "..", "src/renderer");
const sharpUrl = pathToFileURL(
  path.join(RENDERER, "node_modules", "sharp", "dist", "index.mjs")
).href;
const icoUrl = pathToFileURL(
  path.join(RENDERER, "node_modules", "png-to-ico", "index.js")
).href;
const sharp = (await import(sharpUrl)).default;
const pngToIco = (await import(icoUrl)).default;

const ROOT = path.resolve(import.meta.dirname, "../..");
const SVG_PATH = path.join(ROOT, "src/renderer/public/icon.svg");
const PUBLIC_DIR = path.join(ROOT, "src/renderer/public");
const RESOURCES_DIR = path.join(ROOT, "resources");

const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const svg = await fs.readFile(SVG_PATH, "utf8");

  // 1) 生成多尺寸 PNG
  const pngBuffers = [];
  for (const size of SIZES) {
    const buf = await sharp(Buffer.from(svg))
      .resize(size, size, { fit: "cover" })
      .png()
      .toBuffer();
    pngBuffers.push({ size, buf });
    const outPath = path.join(PUBLIC_DIR, `icon-${size}.png`);
    await fs.writeFile(outPath, buf);
    console.log(`  ✓ ${outPath}  (${buf.length} bytes)`);
  }

  // 2) 合成 .ico（Windows 任务栏、Alt-Tab、文件图标）
  const ico = await pngToIco(pngBuffers.map((p) => p.buf));
  await fs.writeFile(path.join(PUBLIC_DIR, "icon.ico"), ico);
  console.log(
    `  ✓ ${path.join(PUBLIC_DIR, "icon.ico")}  (${ico.length} bytes, ${SIZES.length} sizes)`
  );

  // 3) 同步一份到 resources/（开发模式下托盘、右键菜单从这里取图标）
  await fs.mkdir(RESOURCES_DIR, { recursive: true });
  await fs.writeFile(path.join(RESOURCES_DIR, "icon.ico"), ico);
  console.log(`  ✓ ${path.join(RESOURCES_DIR, "icon.ico")}  (${ico.length} bytes)`);

  console.log("\nDone — 新的 Productivity Teal 图标已就位。");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
