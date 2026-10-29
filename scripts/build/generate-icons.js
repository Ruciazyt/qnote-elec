/**
 * 生成 macOS 打包所需的图标
 *
 * ## 为什么需要它
 *
 * 仓库里原本只有一个 `resources/icon.ico`。它有两个问题：
 *
 * 1. **macOS 不认 .ico**。Electron 的 `nativeImage.createFromPath` 在 macOS 上
 *    读 .ico 会得到空图 —— 托盘图标直接抛「无法加载图标文件」，主窗口图标也是空的。
 * 2. **macOS 应用图标必须是 .icns**，且至少要有一张 512×512 以上的位图。
 *    仓库里最大的 PNG 只有 256×256，撑不起 macOS 的图标规格。
 *
 * 所以这里从矢量源 `src/renderer/public/icon.svg` 现场生成：
 *
 * - `build/icon.icns`        —— electron-builder 的 `mac.icon` 来源
 * - `resources/icon.png`     —— 运行时图标（窗口图标 / 打包后的资源目录）
 * - `resources/icon-tray.png`—— 托盘图标源图
 *
 * ## 为什么 mac 用「满幅方形」而运行时图标保留圆角
 *
 * macOS 的应用图标由系统自己加圆角遮罩（squircle）。如果再送一张已经切好圆角、
 * 四角透明的图过去，就会出现「圆角套圆角」，边缘发虚、四角透出桌面背景。
 * 正确做法是送满幅方形位图，把圆角交给系统。
 *
 * 而托盘图标、窗口图标是应用内自己画的，不经过系统遮罩，保留圆角才好看。
 *
 * ## 依赖
 *
 * `sharp` 是渲染层工作区（src/renderer）的 devDependency，根工作区没有。
 * 这里用 `createRequire` 从渲染层的 package.json 解析，避免给根 package.json
 * 再加一个依赖（也会多一份 Dependabot 告警面）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const projectRoot = path.resolve(__dirname, "..", "..");
const sourceSvgPath = path.join(projectRoot, "src", "renderer", "public", "icon.svg");
const buildDir = path.join(projectRoot, "build");
const resourcesDir = path.join(projectRoot, "resources");

/**
 * icns 容器里的图块类型与像素尺寸
 *
 * 对应关系是 macOS 的 @1x / @2x 惯例：
 *   ic11 = 16pt@2x = 32px    ic12 = 32pt@2x = 64px
 *   ic07 = 128px             ic08 = 256px
 *   ic09 = 512px             ic10 = 512pt@2x = 1024px
 */
const ICNS_ENTRIES = [
  { type: "ic11", size: 32 },
  { type: "ic12", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 },
];

/** 运行时图标：托盘用的小图、应用图标用的通用尺寸 */
const TRAY_ICON_SIZE = 64;
const APP_ICON_SIZE = 512;

function loadSharp() {
  const requireFromRenderer = createRequire(path.join(projectRoot, "src", "renderer", "package.json"));
  try {
    return requireFromRenderer("sharp");
  } catch (error) {
    throw new Error(
      "找不到 sharp（渲染层工作区的 devDependency）。\n" +
        "请先执行 pnpm install --frozen-lockfile，再重试。"
    );
  }
}

/** 读矢量源，失败时给出可操作的提示 */
function readSourceSvg() {
  if (!fs.existsSync(sourceSvgPath)) {
    throw new Error(`图标源文件不存在：${sourceSvgPath}`);
  }
  return fs.readFileSync(sourceSvgPath, "utf8");
}

/**
 * 把 SVG 变成满幅方形（去掉圆角），供 macOS 系统自己加遮罩
 *
 * 做法是改 rx 属性而不是重新画 —— 颜色、Q 的位置、比例全都原样保留。
 */
function toSquareSvg(svg) {
  return svg.replace(/\brx="[\d.]+"/, 'rx="0"');
}

/**
 * 按目标像素尺寸渲染 PNG
 *
 * 同时改掉 width/height（viewBox 不动），让渲染器直接按目标分辨率画矢量，
 * 而不是先画成 256 再放大 —— 后者在 1024px 下边缘会糊。
 */
async function renderPng(sharp, svg, size) {
  const sized = svg
    .replace(/\bwidth="[\d.]+"/, `width="${size}"`)
    .replace(/\bheight="[\d.]+"/, `height="${size}"`);
  return sharp(Buffer.from(sized)).png({ compressionLevel: 9 }).toBuffer();
}

/** icns 的单个图块：4 字节类型 + 4 字节长度（含这 8 字节头）+ 数据 */
function buildIcnsChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}

/** 拼出完整的 icns 容器 */
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

  // ---- macOS 应用图标：满幅方形 ----
  const chunks = [];
  for (const entry of ICNS_ENTRIES) {
    const png = await renderPng(sharp, squareSvg, entry.size);
    chunks.push(buildIcnsChunk(entry.type, png));
  }
  const icnsPath = path.join(buildDir, "icon.icns");
  writeFile(icnsPath, buildIcns(chunks));
  console.log(`✔ macOS 应用图标: ${path.relative(projectRoot, icnsPath)} (${ICNS_ENTRIES.length} 个尺寸)`);

  // ---- 运行时图标：保留圆角 ----
  const appIconPath = path.join(resourcesDir, "icon.png");
  writeFile(appIconPath, await renderPng(sharp, originalSvg, APP_ICON_SIZE));
  console.log(`✔ 应用图标: ${path.relative(projectRoot, appIconPath)} (${APP_ICON_SIZE}px)`);

  const trayIconPath = path.join(resourcesDir, "icon-tray.png");
  writeFile(trayIconPath, await renderPng(sharp, originalSvg, TRAY_ICON_SIZE));
  console.log(`✔ 托盘图标: ${path.relative(projectRoot, trayIconPath)} (${TRAY_ICON_SIZE}px)`);
}

main().catch((error) => {
  console.error(`\n❌ 生成图标失败：${error.message}`);
  process.exit(1);
});
