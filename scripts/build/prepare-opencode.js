const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const packageDir = path.join(projectRoot, "node_modules", "opencode-ai");
const sourceDir = path.join(packageDir, "bin");
const targetDir = path.join(projectRoot, "resources", "opencode");

function findSource() {
  for (const name of ["opencode.exe", "opencode"]) {
    const candidate = path.join(sourceDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readVersion() {
  try {
    return require(path.join(packageDir, "package.json")).version || "";
  } catch {
    return "";
  }
}

function main() {
  const source = findSource();
  if (!source) {
    console.error(
      "[opencode] 找不到 node_modules/opencode-ai/bin 下的可执行文件。\n" +
        "           请先执行 pnpm install，确认 opencode-ai 已安装且其 postinstall 已执行。"
    );
    process.exit(1);
  }

  const targetName = process.platform === "win32" ? "opencode.exe" : "opencode";
  const target = path.join(targetDir, targetName);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, target);
  if (process.platform !== "win32") {
    // eslint-disable-next-line sonarjs/file-permissions -- 打包后的 opencode 需要可执行位，0o755 是常规可执行文件权限
    fs.chmodSync(target, 0o755);
  }

  const version = readVersion();
  fs.writeFileSync(
    path.join(targetDir, "version.json"),
    JSON.stringify({ version, source: path.basename(source) }, null, 2),
    "utf8"
  );

  const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(
    `[opencode] 已内置 opencode ${version || "未知版本"}（${targetName}, ${size}MB）`
  );
}

main();
