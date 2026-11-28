import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const CODESIGN = "/usr/bin/codesign";
const DITTO = "/usr/bin/ditto";
const XATTR = "/usr/bin/xattr";

export const MAC_INSTALLER_DIR_NAME = "qnote-mac-updater";
export const MAC_INSTALL_WAIT_SECONDS = 120;

export interface MacBundleInspection {
  unsigned: boolean;
  reason: string;
}

export interface MacInstallTarget {
  bundlePath: string;
  appName: string;
}

export interface MacInstallScriptOptions {
  archivePath: string;
  bundlePath: string;
  appName: string;
  logPath: string;
  scriptPath: string;
  pid: number;
  waitSeconds: number;
}

const QUOTE = String.fromCharCode(39);
const BACKSLASH = String.fromCharCode(92);

export function shellQuote(value: string): string {
  return (
    QUOTE +
    value.split(QUOTE).join(QUOTE + BACKSLASH + QUOTE + QUOTE) +
    QUOTE
  );
}

export function isMacBundleUnsigned(bundlePath: string): boolean {
  const resources = path.join(bundlePath, "Contents", "_CodeSignature", "CodeResources");
  return !fs.existsSync(resources);
}

export async function inspectMacBundleSignature(
  bundlePath: string
): Promise<MacBundleInspection> {
  if (isMacBundleUnsigned(bundlePath)) {
    return { unsigned: true, reason: "bundle 缺少 _CodeSignature/CodeResources" };
  }
  try {
    const stdout = await readCommandOutput(CODESIGN, ["-dv", "--verbose=2", bundlePath]);
    if (!/Authority=Developer ID Application/.test(stdout)) {
      return { unsigned: true, reason: "签名不是 Developer ID Application" };
    }
    return { unsigned: false, reason: "已使用 Developer ID 签名" };
  } catch (err) {
    const output = `${(err as { stdout?: string }).stdout ?? ""}${(
      err as { stderr?: string }
    ).stderr ?? ""}`;
    if (/Authority=Developer ID Application/.test(output)) {
      return { unsigned: false, reason: "已使用 Developer ID 签名" };
    }
    return { unsigned: true, reason: `codesign 探测失败: ${output.trim() || String(err)}` };
  }
}

function readCommandOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }));
        return;
      }
      resolve(`${stdout}${stderr}`);
    });
  });
}

export function resolveMacInstallTarget(): MacInstallTarget | null {
  const runningBundle = path.resolve(path.dirname(app.getPath("exe")), "..", "..");
  const candidates = [runningBundle, path.join("/Applications", "QNote.app")];
  for (const bundlePath of candidates) {
    if (!fs.existsSync(bundlePath)) continue;
    if (bundlePath.startsWith("/Volumes/")) continue;
    try {
      fs.accessSync(path.dirname(bundlePath), fs.constants.W_OK);
    } catch {
      continue;
    }
    return { bundlePath, appName: path.basename(bundlePath) };
  }
  return null;
}

function toShellPath(value: string): string {
  return value.split(BACKSLASH).join("/");
}

export function buildInstallScript(options: MacInstallScriptOptions): string {
  const { archivePath, bundlePath, appName, logPath, pid, waitSeconds } = options;
  const stageDir = path.posix.join(path.posix.dirname(toShellPath(logPath)), "staged");
  return `#!/bin/sh
set -e
export LC_ALL=en_US.UTF-8
ARCHIVE=${shellQuote(toShellPath(archivePath))}
BUNDLE=${shellQuote(toShellPath(bundlePath))}
STAGE=${shellQuote(stageDir)}
LOG=${shellQuote(toShellPath(logPath))}
APP_NAME=${shellQuote(appName)}
WAIT_LIMIT=${waitSeconds}
APP_PID=${pid}

log() {
  printf '%s %s\\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
}

log "等待应用退出 (pid $APP_PID)"
waited=0
while /bin/kill -0 "$APP_PID" 2>/dev/null; do
  waited=$((waited + 1))
  if [ "$waited" -gt "$WAIT_LIMIT" ]; then
    log "等待应用退出超时"
    exit 1
  fi
  sleep 1
done

log "开始解包更新包"
rm -rf "$STAGE"
mkdir -p "$STAGE"
if ! ${DITTO} -x -k --sequesterRsrc --rsrc "$ARCHIVE" "$STAGE" >> "$LOG" 2>&1; then
  log "解包失败"
  exit 1
fi

NEW_APP=""
if [ -d "$STAGE/$APP_NAME" ]; then
  NEW_APP="$STAGE/$APP_NAME"
elif [ -d "$STAGE/Contents" ]; then
  NEW_APP="$STAGE"
else
  NEW_APP=$(/usr/bin/find "$STAGE" -maxdepth 2 -name '*.app' -type d | /usr/bin/head -n 1)
fi

if [ -z "$NEW_APP" ] || [ ! -d "$NEW_APP" ]; then
  log "更新包内未找到 .app"
  exit 1
fi

log "清理隔离属性并检查签名"
${XATTR} -dr com.apple.quarantine "$NEW_APP" >/dev/null 2>&1 || true
if ${CODESIGN} --verify --deep --strict "$NEW_APP" >/dev/null 2>&1; then
  log "保留更新包原有的 Developer ID 签名"
else
  log "更新包没有有效签名，改用 ad-hoc 签名"
  ${CODESIGN} --force --deep --sign - "$NEW_APP" >> "$LOG" 2>&1 || log "ad-hoc 签名跳过"
fi

BACKUP="$BUNDLE.old"
rm -rf "$BACKUP"

log "替换旧版本"
if ! mv "$BUNDLE" "$BACKUP"; then
  log "备份旧版本失败"
  exit 1
fi

if ! mv "$NEW_APP" "$BUNDLE"; then
  log "放入新版本失败，执行回滚"
  mv "$BACKUP" "$BUNDLE" || true
  exit 1
fi

rm -rf "$BACKUP"
log "安装完成，重新启动应用"
/usr/bin/open "$BUNDLE"
`;
}

export async function launchMacInstaller(options: MacInstallScriptOptions): Promise<void> {
  const dir = path.dirname(options.scriptPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const script = buildInstallScript(options);
  await fs.promises.writeFile(options.scriptPath, script, "utf8");
  await fs.promises.chmod(options.scriptPath, 0o700);
  await fs.promises.writeFile(
    options.logPath,
    `bundle=${options.bundlePath}\narchive=${options.archivePath}\n`,
    "utf8"
  );

  const child = spawn("/bin/sh", [options.scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function getMacInstallerDir(): string {
  return path.join(app.getPath("userData"), MAC_INSTALLER_DIR_NAME);
}
