const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..", "..");
const pkg = require(path.join(projectRoot, "package.json"));

function cacheRoot() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "electron-builder", "Cache", "winCodeSign");
}

function findRcedit() {
  const root = cacheRoot();
  if (!fs.existsSync(root)) return null;
  for (const dir of fs.readdirSync(root)) {
    const candidate = path.join(root, dir, "rcedit-x64.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

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
