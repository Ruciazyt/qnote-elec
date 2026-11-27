const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const crypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..", "..");
const targetDir = path.join(projectRoot, "resources", "gitlab-runner");

const VERSION = process.env.QNOTE_GITLAB_RUNNER_VERSION || "19.6.1";
const RELEASE = VERSION.startsWith("v") ? VERSION : "v" + VERSION;
const BASE_URL = "https://gitlab-runner-downloads.s3.amazonaws.com";

function assetName() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "win32") {
    if (arch === "arm64") return "gitlab-runner-windows-arm64.exe";
    if (arch === "ia32") return "gitlab-runner-windows-386.exe";
    return "gitlab-runner-windows-amd64.exe";
  }
  if (platform === "darwin") {
    return arch === "arm64"
      ? "gitlab-runner-darwin-arm64"
      : "gitlab-runner-darwin-amd64";
  }
  if (arch === "arm64") return "gitlab-runner-linux-arm64";
  if (arch === "arm") return "gitlab-runner-linux-arm";
  if (arch === "ia32") return "gitlab-runner-linux-386";
  return "gitlab-runner-linux-amd64";
}

function targetName() {
  return process.platform === "win32" ? "gitlab-runner.exe" : "gitlab-runner";
}

function targetPath() {
  return path.join(targetDir, targetName());
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("下载校验文件失败 " + response.status + "：" + url);
  }
  return response.text();
}

async function expectedChecksum(name) {
  const text = await fetchText(BASE_URL + "/" + RELEASE + "/release.sha256");
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const base = parts[1].replace(/^\*/, "").split("/").pop();
    if (base === name) return parts[0].toLowerCase();
  }
  return null;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("下载失败 " + response.status + "：" + url);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destination)
  );
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

async function main() {
  const name = assetName();
  const target = targetPath();

  if (fs.existsSync(target)) {
    const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
    console.log(`[gitlab-runner] 已存在 ${name}（${size}MB），跳过下载`);
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const url = BASE_URL + "/" + RELEASE + "/binaries/" + name;
  console.log(`[gitlab-runner] 下载 ${name}（${VERSION}）…`);
  await download(url, target);

  if (process.platform !== "win32") {
    // eslint-disable-next-line sonarjs/file-permissions -- 打包后的 runner 需要可执行位，0o755 是常规可执行文件权限
    fs.chmodSync(target, 0o755);
  }

  const expected = await expectedChecksum(name).catch(() => null);
  if (expected) {
    const actual = sha256(target);
    if (actual !== expected) {
      fs.rmSync(target, { force: true });
      throw new Error(
        "校验和不匹配：期望 " + expected + "，实际 " + actual
      );
    }
    console.log("[gitlab-runner] 校验和通过");
  } else {
    console.warn("[gitlab-runner] 拿不到校验和，跳过校验");
  }

  fs.writeFileSync(
    path.join(targetDir, "version.json"),
    JSON.stringify({ version: VERSION, source: name }, null, 2),
    "utf8"
  );

  const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`[gitlab-runner] 已内置 gitlab-runner ${VERSION}（${name}, ${size}MB）`);
}

main().catch((error) => {
  console.error("[gitlab-runner] 准备失败：" + error.message);
  process.exit(1);
});
