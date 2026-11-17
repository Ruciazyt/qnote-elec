const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const projectRoot = path.resolve(__dirname, "..", "..");
const sourceSvgPath = path.join(projectRoot, "src", "renderer", "public", "icon.svg");
const buildDir = path.join(projectRoot, "build");
const resourcesDir = path.join(projectRoot, "resources");

const ICNS_ENTRIES = [
  { type: "ic11", size: 32 },
  { type: "ic12", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 },
];

const TRAY_ICON_SIZE = 64;
const APP_ICON_SIZE = 512;

function loadSharp() {
  const requireFromRenderer = createRequire(path.join(projectRoot, "src", "renderer", "package.json"));
  try {
    return requireFromRenderer("sharp");
  } catch (error) {
    throw new Error(
      "找不到 sharp（渲染层工作区的 devDependency）。\n" +
        "请先执行 pnpm install --frozen-lockfile，再重试。",
      { cause: error }
    );
  }
}

function readSourceSvg() {
  if (!fs.existsSync(sourceSvgPath)) {
    throw new Error(`图标源文件不存在：${sourceSvgPath}`);
  }
  return fs.readFileSync(sourceSvgPath, "utf8");
}

function toSquareSvg(svg) {
  return svg.replace(/\brx="[\d.]+"/, 'rx="0"');
}

async function renderPng(sharp, svg, size) {
  const sized = svg
    .replace(/\bwidth="[\d.]+"/, `width="${size}"`)
    .replace(/\bheight="[\d.]+"/, `height="${size}"`);
  return sharp(Buffer.from(sized)).png({ compressionLevel: 9 }).toBuffer();
}

function buildIcnsChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}

function buildIcns(chunks) {
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

function writeFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

async function main() {
  const sharp = loadSharp();
  const originalSvg = readSourceSvg();
  const squareSvg = toSquareSvg(originalSvg);

  const pngs = await Promise.all(
    ICNS_ENTRIES.map((entry) => renderPng(sharp, squareSvg, entry.size))
  );
  const chunks = ICNS_ENTRIES.map((entry, index) => buildIcnsChunk(entry.type, pngs[index]));
  const icnsPath = path.join(buildDir, "icon.icns");
  writeFile(icnsPath, buildIcns(chunks));
  console.log(`✔ macOS 应用图标: ${path.relative(projectRoot, icnsPath)} (${ICNS_ENTRIES.length} 个尺寸)`);

  const appIconPath = path.join(resourcesDir, "icon.png");
  writeFile(appIconPath, await renderPng(sharp, originalSvg, APP_ICON_SIZE));
  console.log(`✔ 应用图标: ${path.relative(projectRoot, appIconPath)} (${APP_ICON_SIZE}px)`);

  const trayIconPath = path.join(resourcesDir, "icon-tray.png");
  writeFile(trayIconPath, await renderPng(sharp, originalSvg, TRAY_ICON_SIZE));
  console.log(`✔ 托盘图标: ${path.relative(projectRoot, trayIconPath)} (${TRAY_ICON_SIZE}px)`);
}

main().catch((error) => {
  console.error(`\n❌ 生成图标失败：${error.message}`);
  if (error.cause) {
    console.error(`   原始错误：${error.cause.message || String(error.cause)}`);
  }
  process.exit(1);
});
