const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const configPath = path.join(projectRoot, "build", "electron-builder.json");

function electronBuilderCli() {
  try {
    return require.resolve("electron-builder/cli.js");
  } catch (error) {
    console.error(
      "\n❌ 找不到 electron-builder。\n" +
        "   请先执行 pnpm install --frozen-lockfile，再重试。\n" +
        `   （原始错误：${error.message}）`
    );
    process.exit(1);
  }
}

const extraArgs = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));

const hasSigning = !!(process.env.CSC_LINK || process.env.WIN_CSC_LINK);

const SYMLINK_ERROR = /cannot create symbolic link|symbolic link/i;

function isMacBuild() {
  return (
    process.platform === "darwin" ||
    extraArgs.some((arg) => arg === "--mac" || arg.startsWith("--mac="))
  );
}

function generateIcons() {
  console.log("\n▶ 生成图标");
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "build", "generate-icons.js")],
    { cwd: projectRoot, stdio: "inherit" }
  );

  if (result.status === 0) {
    return true;
  }

  if (isMacBuild()) {
    console.error("\n❌ 图标生成失败，macOS 构建无法继续。");
    return false;
  }

  console.warn("\n⚠️  图标生成失败（不影响 Windows 构建 —— Windows 用 resources/icon.ico）。");
  return true;
}

function runElectronBuilder(args, label) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(
    process.execPath,
    [electronBuilderCli(), "--config", configPath, ...args],
    { cwd: projectRoot, stdio: "inherit" }
  );
  return result.status === 0;
}

function main() {
  if (!generateIcons()) {
    process.exit(1);
  }

  const first = spawnSync(
    process.execPath,
    [electronBuilderCli(), "--config", configPath, ...extraArgs],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );

  if (first.status === 0) {
    process.exit(0);
  }

  const output = `${first.stdout || ""}\n${first.stderr || ""}`;
  if (!SYMLINK_ERROR.test(output)) {
    if (first.stdout) process.stdout.write(first.stdout);
    if (first.stderr) process.stderr.write(first.stderr);
    console.error("\n❌ 打包失败（原因见上方输出）");
    process.exit(first.status || 1);
  }

  if (hasSigning) {
    console.error(
      "\n❌ 打包失败：解压 winCodeSign 需要创建符号链接的权限，" +
        "而当前配置了代码签名证书，不能降级构建（降级会丢签名）。\n" +
        "   解决办法：开启 Windows「开发者模式」，或用管理员身份运行本命令。"
    );
    process.exit(1);
  }

  console.error(
    "\n⚠️  检测到符号链接权限不足（winCodeSign 里 macOS 的库文件建不了链接）。\n" +
      "   这不影响 Windows 构建，改用「跳过 exe 资源写入 + 手工补图标」的方式重来。"
  );

  const second = runElectronBuilder(
    ["--config.win.signAndEditExecutable=false", ...extraArgs],
    "重试打包（跳过 exe 资源写入）"
  );
  if (!second) {
    console.error("\n❌ 降级打包仍然失败，请检查上方输出");
    process.exit(1);
  }

  console.log("\n▶ 补写图标与版本信息");
  const outputArg = extraArgs.find((a) => a.startsWith("--config.directories.output="));
  const applyArgs = outputArg ? [outputArg.split("=")[1]] : [];
  const apply = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "build", "apply-exe-resources.js"), ...applyArgs],
    { cwd: projectRoot, stdio: "inherit" }
  );
  if (apply.status !== 0) {
    console.error(
      "\n⚠️  打包成功，但补写图标失败 —— 产物的 exe 没有自定义图标和版本信息。\n" +
        "   可稍后手动执行：node scripts/build/apply-exe-resources.js"
    );
  }

  console.log("\n✅ 打包完成（已自动处理符号链接权限问题）");
  process.exit(0);
}

main();
