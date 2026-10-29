/**
 * 打包入口：跑 electron-builder，并在「符号链接权限不足」时自动降级重试
 *
 * ## 为什么需要这个包装脚本
 *
 * electron-builder 要给 exe 写图标和版本信息，用的是 winCodeSign 里的 rcedit。
 * 但它会**整包解压** winCodeSign，而那个包里带了 macOS 的 .dylib 符号链接。
 * 非管理员、且系统没开「开发者模式」的 Windows 建不了符号链接，解压直接失败：
 *
 *   ERROR: Cannot create symbolic link : 客户端没有所需的权限
 *     ...\winCodeSign\<hash>\darwin\10.12\lib\libcrypto.dylib
 *
 * 失败的是 macOS 的库文件，跟 Windows 构建毫无关系，纯粹是环境权限问题。
 *
 * ## 降级策略
 *
 * 第一次照常打包。失败信息里带符号链接报错时：
 *   1. 改用 `--config.win.signAndEditExecutable=false` 重来一次
 *      （跳过 rcedit，产物 exe 暂时没有自定义图标和版本信息）
 *   2. 用缓存里的 rcedit-x64.exe 手工补上图标与版本信息
 *      （rcedit 是独立可执行文件，不需要符号链接）
 *
 * 结果与正常打包一致，只是少了 NSIS 安装包自身的图标处理。
 *
 * ## 为什么不自动降级
 *
 * 配了代码签名证书时**不降级**：降级产物会丢签名，属于静默降级。
 * 这时直接报错，让人去开开发者模式或用管理员身份跑。
 */
const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const configPath = path.join(projectRoot, "build", "electron-builder.json");

/**
 * 透传给 electron-builder 的额外参数（CI 会用 --publish never）
 *
 * pnpm 与 npm 在这里不一样：`pnpm run build:app -- --publish never` 会把
 * 那个 `--` 也当成真实参数传进来（npm 会吃掉它），于是脚本收到的是
 * ["--", "--publish", "never"]。yargs 遇到 `--` 之后的内容一律当位置参数，
 * `--publish never` 就被忽略了 —— electron-builder 于是认为自己在 tag 上
 * 构建，会自己去 GitHub 建 Release（还多发一次 api.github.com 请求）。
 * 所以这里把开头的 `--` 去掉。
 */
const extraArgs = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));

/**
 * 是否配了代码签名
 *
 * 只看证书本身（CSC_LINK / WIN_CSC_LINK），不看口令。
 * electron-builder 只有拿到证书才会签名，口令单独存在不会触发签名
 * （它的 windowsSignToolManager 遇到空的 CSC_LINK 直接返回「不签名」）。
 * 把 CSC_KEY_PASSWORD 也算进来会让「证书已停用、只剩口令」的情况被误判成
 * 配了签名，于是符号链接权限不足时不肯降级构建，构建直接失败。
 */
const hasSigning = !!(process.env.CSC_LINK || process.env.WIN_CSC_LINK);

/**
 * 符号链接权限不足的特征
 *
 * 以英文那句为准：electron-builder 的错误输出里，英文原文始终完整，
 * 而紧跟其后的中文部分会随系统代码页变成乱码，不能作为匹配依据。
 */
const SYMLINK_ERROR = /cannot create symbolic link|symbolic link/i;

/**
 * 是否是 macOS 构建
 *
 * 两种判据：跑在 macOS 上，或者命令行里显式带了 --mac。
 */
function isMacBuild() {
  return (
    process.platform === "darwin" ||
    extraArgs.some((arg) => arg === "--mac" || arg.startsWith("--mac="))
  );
}

/**
 * 生成图标
 *
 * macOS 的应用图标必须是 .icns —— 仓库里原本只有 icon.ico，
 * 而 Electron 的 nativeImage 在 macOS 上读不了 .ico（托盘图标直接抛错）。
 * 运行时图标（窗口图标、托盘图标）也要 PNG。
 * 这些都由 scripts/build/generate-icons.js 从 src/renderer/public/icon.svg 现场生成。
 *
 * mac 构建缺了图标打出来的包没法用，直接失败；
 * Windows 构建用的是仓库里现成的 resources/icon.ico，失败只警告。
 */
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
    "npx",
    ["electron-builder", "--config", configPath, ...args],
    { cwd: projectRoot, stdio: "inherit", shell: true }
  );
  return result.status === 0;
}

function main() {
  // 图标要先备齐 —— macOS 的 .icns 是打包的硬前提
  if (!generateIcons()) {
    process.exit(1);
  }

  // 第一次：正常打包
  const first = spawnSync("npx", ["electron-builder", "--config", configPath, ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (first.status === 0) {
    process.exit(0);
  }

  const output = `${first.stdout || ""}\n${first.stderr || ""}`;
  if (!SYMLINK_ERROR.test(output)) {
    // 不是符号链接权限问题，原样把失败信息吐出来
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

  // 第二次：跳过 rcedit
  const second = runElectronBuilder(
    ["--config.win.signAndEditExecutable=false", ...extraArgs],
    "重试打包（跳过 exe 资源写入）"
  );
  if (!second) {
    console.error("\n❌ 降级打包仍然失败，请检查上方输出");
    process.exit(1);
  }

  // 第三步：手工把图标和版本信息写回去
  console.log("\n▶ 补写图标与版本信息");
  // 输出目录要和打包时一致：从额外参数里把 --config.directories.output= 摘出来
  const outputArg = extraArgs.find((a) => a.startsWith("--config.directories.output="));
  const applyArgs = outputArg ? [outputArg.split("=")[1]] : [];
  const apply = spawnSync(
    "node",
    [path.join(projectRoot, "scripts", "build", "apply-exe-resources.js"), ...applyArgs],
    { cwd: projectRoot, stdio: "inherit", shell: true }
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
