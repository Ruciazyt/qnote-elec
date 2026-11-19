const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const outDir = path.join(projectRoot, "dist", "native");
const CRATE_ROOTS = ["src"];
const SKIP_DIRS = new Set(["node_modules", "target", "dist", "coverage"]);
const MAC_TARGETS = ["x86_64-apple-darwin", "aarch64-apple-darwin"];

const REQUIRED = process.env.RUST_REQUIRED === "1";
const IS_WIN = process.platform === "win32";

function log(message) {
  console.log(message);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: IS_WIN,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function cargoVersion() {
  const result = run("cargo", ["--version"]);
  return result.status === 0 ? String(result.stdout || "").trim() : null;
}

function findCrates() {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, "Cargo.toml"))) {
        found.push(full);
        continue;
      }
      walk(full, depth + 1);
    }
  };
  for (const root of CRATE_ROOTS) {
    const abs = path.join(projectRoot, root);
    if (fs.existsSync(abs)) walk(abs, 0);
  }
  return found.sort();
}

function libName(crateDir) {
  const manifest = fs.readFileSync(path.join(crateDir, "Cargo.toml"), "utf8");
  const match = manifest.match(/^name\s*=\s*"([^"]+)"/m);
  return (match ? match[1] : path.basename(crateDir)).replace(/-/g, "_");
}

function artifact(crateDir, lib, target) {
  const dir = target
    ? path.join(crateDir, "target", target, "release")
    : path.join(crateDir, "target", "release");
  if (process.platform === "darwin") return path.join(dir, `lib${lib}.dylib`);
  if (IS_WIN) return path.join(dir, `${lib}.dll`);
  return path.join(dir, `lib${lib}.so`);
}

function buildCrate(crateDir, lib) {
  if (process.platform !== "darwin") {
    const result = run("cargo", ["build", "--release", "--manifest-path", path.join(crateDir, "Cargo.toml")]);
    if (result.status !== 0) {
      throw new Error(`cargo build 失败：${result.stdout || ""}${result.stderr || ""}`);
    }
    return [artifact(crateDir, lib)];
  }

  const built = [];
  for (const target of MAC_TARGETS) {
    run("rustup", ["target", "add", target]);
    const result = run("cargo", [
      "build",
      "--release",
      "--target",
      target,
      "--manifest-path",
      path.join(crateDir, "Cargo.toml"),
    ]);
    if (result.status !== 0) {
      throw new Error(`cargo build --target ${target} 失败：${result.stdout || ""}${result.stderr || ""}`);
    }
    built.push(artifact(crateDir, lib, target));
  }

  const present = built.filter((file) => fs.existsSync(file));
  if (present.length === 1) return present;

  const merged = path.join(crateDir, "target", `universal-${lib}`);
  const lipo = run("lipo", ["-create", "-output", merged, ...present]);
  if (lipo.status !== 0) {
    throw new Error(`lipo 合并失败：${lipo.stdout || ""}${lipo.stderr || ""}`);
  }
  return [merged];
}

function copyWithRetry(source, target, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.copyFileSync(source, target);
      return;
    } catch (error) {
      if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
      if (i === attempts - 1) {
        throw new Error(
          `${target} 被占用，关掉正在运行的 QNote 再编译（Windows 上已加载的 .node 不会释放）`
        );
      }
      sleep(500);
    }
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const found = findCrates();
  if (!found.length) {
    log("src/ 下没有找到 Rust crate，跳过原生模块编译");
    return;
  }

  const version = cargoVersion();
  if (!version) {
    const message = "找不到 cargo —— 本次不编译原生模块，应用会回退到 TypeScript 实现";
    if (REQUIRED) {
      console.error(`❌ ${message}（RUST_REQUIRED=1，构建中止）`);
      process.exit(1);
    }
    log(`⚠️  ${message}`);
    return;
  }

  log(`▶ 编译原生模块（${version}）`);
  log(`  crate: ${found.map((dir) => path.relative(projectRoot, dir)).join(", ")}`);

  for (const crateDir of found) {
    const name = path.basename(crateDir);
    const lib = libName(crateDir);
    const files = buildCrate(crateDir, lib);

    for (const file of files) {
      const target = path.join(outDir, `${lib}.node`);
      copyWithRetry(file, target);
      log(`✔ ${name} → ${path.relative(projectRoot, target)}`);
    }

    const wrapper = path.join(crateDir, "index.cjs");
    if (fs.existsSync(wrapper)) {
      const target = path.join(outDir, `${name}.cjs`);
      copyWithRetry(wrapper, target);
      log(`✔ ${name} 桥接层 → ${path.relative(projectRoot, target)}`);
    }
  }

  log("✔ 原生模块编译完成");
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
