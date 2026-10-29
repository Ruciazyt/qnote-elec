/**
 * 用 rcedit 给打包产物写入图标与版本信息
 *
 * ## 为什么需要这个脚本
 *
 * electron-builder 默认用 winCodeSign 里的 rcedit 给 exe 写图标和版本信息。
 * 但 winCodeSign 这个工具包是**整包解压**的，里面带了 macOS 的 .dylib
 * 符号链接 —— 非管理员、且系统没开「开发者模式」的 Windows 建不了符号链接，
 * 解压直接失败，整个打包中断（报 "Cannot create symbolic link"）。
 *
 * ## 解法
 *
 * rcedit-x64.exe 本身是个独立可执行文件，**不需要符号链接**。
 * 它在解压失败时已经躺在缓存目录里了（失败的只有 2 个 macOS 链接），
 * 所以可以直接调它，把 electron-builder 跳过的那一步补上。
 *
 * 用法：
 *   node scripts/build/apply-exe-resources.js
 *
 * 幂等：electron-builder 自己写过的话再写一遍没有副作用。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..", "..");
const pkg = require(path.join(projectRoot, "package.json"));

/** electron-builder 的缓存根目录 */
function cacheRoot() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "electron-builder", "Cache", "winCodeSign");
}

/** 在缓存里找 rcedit-x64.exe（目录名是 hash，版本变了 hash 也会变） */
function findRcedit() {
  const root = cacheRoot();
  if (!fs.existsSync(root)) return null;
  for (const dir of fs.readdirSync(root)) {
    const candidate = path.join(root, dir, "rcedit-x64.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** 需要写入资源信息的 exe：解包目录里的主程序 + 安装包 */
function targets(outputDir) {
  const out = [];
  const productName = pkg.build?.productName || "QNote";
  const unpacked = path.join(outputDir, "win-unpacked", `${productName}.exe`);
  if (fs.existsSync(unpacked)) out.push(unpacked);

  if (fs.existsSync(outputDir)) {
    for (const name of fs.readdirSync(outputDir)) {
      if (!name.toLowerCase().endsWith(".exe")) continue;
      const full = path.join(outputDir, name);
      if (out.includes(full)) continue;
      // 安装包（QNote-Setup-*.exe）也一起处理：降级路径下 electron-builder
      // 没给它写过图标，下载下来的安装包会显示成 Electron 默认图标
      out.push(full);
    }
  }
  return out;
}

function main() {
  const rcedit = findRcedit();
  if (!rcedit) {
    console.error(
      "找不到 rcedit-x64.exe（%LOCALAPPDATA%\\electron-builder\\Cache\\winCodeSign\\*\\rcedit-x64.exe）。\n" +
        "先让 electron-builder 跑一次（哪怕失败），它会把工具解压到缓存里。"
    );
    process.exit(1);
  }

  // 图标候选：QNote 自有图标优先，仓库里资源目录与渲染层 public 各留一份兜底。
  // 别再指向第三方站点的通用图标 —— 那是旧圆形控件的遗留物。
  const iconCandidates = [
    path.join(projectRoot, "resources", "icon.ico"),
    path.join(projectRoot, "src", "renderer", "public", "icon.ico"),
  ];
  const iconPath = iconCandidates.find((p) => fs.existsSync(p));
  if (!iconPath) {
    console.error("找不到图标文件，候选路径都不存在：\n  " + iconCandidates.join("\n  "));
    process.exit(1);
  }

  const version = pkg.version;
  const productName = pkg.build?.productName || "QNote";
  // 输出目录：默认 dist_electron，也可用第一个参数指定（配合 --dir 之外的
  // 自定义 output，验证时很有用）
  const outputArg = process.argv[2];
  const outputDir = outputArg
    ? path.resolve(projectRoot, outputArg)
    : path.join(projectRoot, "dist_electron");
  const list = targets(outputDir);
  if (list.length === 0) {
    console.error(`没有找到打包产物 exe（先跑一次 electron-builder）：${outputDir}`);
    process.exit(1);
  }

  for (const exe of list) {
    const args = [
      exe,
      "--set-icon", iconPath,
      "--set-version-string", "FileDescription", productName,
      "--set-version-string", "ProductName", productName,
      "--set-version-string", "CompanyName", pkg.author || productName,
      "--set-version-string", "LegalCopyright", pkg.build?.copyright || "",
      "--set-file-version", version,
      "--set-product-version", version,
    ];
    try {
      execFileSync(rcedit, args, { stdio: "inherit" });
      console.log(`✅ 已写入图标与版本信息：${path.relative(projectRoot, exe)}`);
    } catch (err) {
      console.error(`❌ 写入失败：${path.relative(projectRoot, exe)}`);
      console.error(`   ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}

main();
