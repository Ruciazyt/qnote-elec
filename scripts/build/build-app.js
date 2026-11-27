const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const configPath = path.join(projectRoot, "build", "electron-builder.json");
const errorLogPath = path.join(projectRoot, ".data", "build", "build-error.log");

function clearErrorLog() {
  try {
    fs.rmSync(errorLogPath, { force: true });
  } catch {
  }
}

function writeErrorLog(chunk) {
  if (!chunk) return;
  try {
    fs.mkdirSync(path.dirname(errorLogPath), { recursive: true });
    fs.appendFileSync(errorLogPath, chunk, "utf8");
  } catch {
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function outputDir() {
  const arg = extraArgs.find((a) => a.startsWith("--config.directories.output="));
  return arg
    ? path.join(projectRoot, arg.split("=")[1])
    : path.join(projectRoot, "dist_electron");
}

function cleanStaleOutput() {
  const dir = outputDir();
  for (const name of ["win-unpacked.tmp", "win-unpacked"]) {
    try {
      fs.rmSync(path.join(dir, name), {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500,
      });
    } catch {
    }
  }
}

function runBuilder(args) {
  return spawnSync(
    process.execPath,
    [electronBuilderCli(), "--config", configPath, ...args],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
}

function runBuilderWithRetry(args) {
  let result = runBuilder(args);
  let attempt = 0;
  while (
    result.status !== 0 &&
    attempt < MOVE_DIR_RETRIES &&
    MOVE_DIR_ERROR.test(`${result.stdout || ""}\n${result.stderr || ""}`)
  ) {
    attempt += 1;
    console.warn(
      `\n⚠️  产物目录被占用（EBUSY/EPERM），清理后重试（第 ${attempt}/${MOVE_DIR_RETRIES} 次）…`
    );
    cleanStaleOutput();
    sleepSync(2000);
    result = runBuilder(args);
  }
  return result;
}

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

const SYMLINK_ERROR = /cannot create symbolic link|symbolic link|symlink/i;
const MOVE_DIR_ERROR = /Failed to move directory|EBUSY|resource busy or locked/i;
const MOVE_DIR_RETRIES = 3;

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
  const result = runBuilderWithRetry(args);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    writeErrorLog(`${result.stdout || ""}\n${result.stderr || ""}`);
  }
  return result.status === 0;
}

function prepareOpencode() {
  console.log("\n▶ 内置 opencode 运行时");
  const script = path.join(projectRoot, "scripts", "build", "prepare-opencode.js");
  const result = spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status === 0;
}

function prepareGitlabRunner() {
  console.log("\n▶ 内置 GitLab Runner");
  const script = path.join(projectRoot, "scripts", "build", "prepare-gitlab-runner.js");
  const result = spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status === 0;
}

function buildRust() {
  console.log("\n▶ 编译 Rust 原生模块");
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "build", "build-rust.js")],
    { cwd: projectRoot, stdio: "inherit" }
  );
  return result.status === 0;
}

function injectCatalogCredentials() {
  const script = path.join(projectRoot, "scripts", "build", "inject-catalog-credentials.js");
  const result = spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status === 0;
}

function main() {
  clearErrorLog();

  if (!generateIcons()) {
    process.exit(1);
  }

  if (!injectCatalogCredentials()) {
    console.error("\n❌ 公共目录凭据注入失败，打包中止。");
    process.exit(1);
  }

  if (!prepareOpencode()) {
    console.error("\n❌ 内置 opencode 运行时失败，打包中止。");
    process.exit(1);
  }

  if (!buildRust()) {
    console.error("\n❌ Rust 原生模块编译失败，打包中止。");
    process.exit(1);
  }

  if (!prepareGitlabRunner()) {
    console.warn(
      "\n⚠️  内置 GitLab Runner 失败 —— 不影响打包，" +
        "但「应用」页的 GitLab 机器人功能将无法自动拉起 Runner。"
    );
  }

  const first = runBuilderWithRetry(extraArgs);

  if (first.status === 0) {
    process.exit(0);
  }

  const output = `${first.stdout || ""}\n${first.stderr || ""}`;
  if (!SYMLINK_ERROR.test(output)) {
    writeErrorLog(output);
    if (first.stdout) process.stdout.write(first.stdout);
    if (first.stderr) process.stderr.write(first.stderr);
    console.error("\n❌ 打包失败（原因见上方输出）");
    process.exit(first.status || 1);
  }

  if (hasSigning) {
    writeErrorLog(output);
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
