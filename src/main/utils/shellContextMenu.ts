import { app } from "electron";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { log } from "../core/system/log";

const execFileAsync = promisify(execFile);

const VERB_KEY = "QNoteAddShortcut";

const VERB_LABEL = "添加到 QNote 快捷方式";

export const ADD_SHORTCUT_FLAG = "--add-shortcut";

const REG_CLASS_ROOTS = ["*", "Directory"] as const;

function launchPrefix(): { prefix: string; error?: string } {
  const exe = `"${app.getPath("exe")}"`;

  if (app.isPackaged) {
    return { prefix: exe };
  }

  const appArg = process.defaultApp ? process.argv[1] : undefined;
  if (appArg && appArg.toLowerCase().endsWith(".js") && fs.existsSync(path.resolve(appArg))) {
    return { prefix: `${exe} "${path.resolve(appArg)}"` };
  }

  return {
    prefix: exe,
    error: "无法确定应用入口路径（process.argv[1] 不是可用的脚本）",
  };
}

function iconSource(): string {
  if (!app.isPackaged) {
    try {
      const icon = path.join(app.getAppPath(), "..", "..", "resources", "icon.ico");
      if (fs.existsSync(icon)) return icon;
    } catch {
    }
  }
  return `${app.getPath("exe")},0`;
}

function hkcuShellKey(root: string, sub: string): string {
  return `HKCU\\Software\\Classes\\${root}\\shell\\${VERB_KEY}${sub}`;
}

export function parseAddShortcutArg(argv: string[]): string | null {
  let sawFlag = false;

  for (const arg of argv) {
    if (arg === ADD_SHORTCUT_FLAG) {
      sawFlag = true;
      continue;
    }
    if (arg.startsWith(`${ADD_SHORTCUT_FLAG}=`)) {
      const value = stripQuotes(arg.slice(arg.indexOf("=") + 1));
      if (value) return value;
    }
  }

  if (!sawFlag) return null;

  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i];
    if (arg.startsWith("-")) continue;
    const value = stripQuotes(arg);
    if (/^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)) return value;
  }
  return null;
}

function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function reg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("reg.exe", args, {
    timeout: 10_000,
    windowsHide: true,
  });
  return { stdout, stderr };
}

async function regKeyExists(key: string): Promise<boolean> {
  try {
    await reg(["query", key]);
    return true;
  } catch {
    return false;
  }
}

async function regCommandValue(commandKey: string): Promise<string | null> {
  try {
    const { stdout } = await reg(["query", commandKey, "/ve"]);
    const match = stdout.match(/REG_SZ\s+(.*)/);
    return match ? match[1].trim() : "";
  } catch {
    return null;
  }
}

export function expectedContextMenuCommand(): { command: string; error?: string } {
  const { prefix, error } = launchPrefix();
  if (error) return { command: "", error };
  return { command: `${prefix} ${ADD_SHORTCUT_FLAG}="%1"` };
}

function isCommandCurrent(actual: string | null): boolean {
  if (actual === null || actual.trim() === "") return false;
  const { command, error } = expectedContextMenuCommand();
  if (error) return false;
  return actual === command;
}

export interface ShellContextMenuStatus {
  supported: boolean;
  enabled: boolean;
  valid: boolean;
  command?: string;
  reason?: string;
}

export function contextMenuSupport(): { supported: boolean; reason?: string } {
  if (process.platform !== "win32") {
    return { supported: false, reason: "仅支持 Windows" };
  }
  const { error } = launchPrefix();
  if (error) {
    return { supported: false, reason: error };
  }
  return { supported: true };
}

export async function getContextMenuStatus(): Promise<ShellContextMenuStatus> {
  const support = contextMenuSupport();
  if (!support.supported) {
    return { supported: false, enabled: false, valid: false, reason: support.reason };
  }
  try {
    const enabled = await regKeyExists(hkcuShellKey("*", ""));
    if (!enabled) {
      return { supported: true, enabled: false, valid: false };
    }

    const commands = await Promise.all(
      REG_CLASS_ROOTS.map((root) => regCommandValue(hkcuShellKey(root, String.raw`\command`)))
    );
    const valid = commands.every((cmd) => isCommandCurrent(cmd));

    return {
      supported: true,
      enabled: true,
      valid,
      command: commands[0] ?? undefined,
      reason: valid
        ? undefined
        : "右键菜单命令已失效（应用可能更新过，或残留了旧版本的注册项），需要重新注册",
    };
  } catch (err) {
    log.warn("[shell-menu] 查询右键菜单注册状态失败:", err);
    return { supported: true, enabled: false, valid: false };
  }
}

export async function repairContextMenu(): Promise<{
  success: boolean;
  repaired: boolean;
  error?: string;
}> {
  const status = await getContextMenuStatus();
  if (!status.supported) {
    return { success: false, repaired: false, error: status.reason };
  }
  if (!status.enabled) {
    return { success: true, repaired: false };
  }
  if (status.valid) {
    return { success: true, repaired: false };
  }

  const result = await setContextMenuEnabled(true);
  if (!result.success) {
    return { success: false, repaired: false, error: result.error };
  }

  const after = await getContextMenuStatus();
  if (!after.valid) {
    return {
      success: false,
      repaired: false,
      error: "重新注册后命令仍然无效，请检查安装目录权限",
    };
  }
  return { success: true, repaired: true };
}

export async function setContextMenuEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const support = contextMenuSupport();
  if (!support.supported) {
    return { success: false, error: support.reason ?? "当前环境不支持" };
  }

  try {
    const { command: expected, error: prefixError } = expectedContextMenuCommand();
    if (prefixError) {
      return { success: false, error: prefixError };
    }

    for (const root of REG_CLASS_ROOTS) {
      const base = hkcuShellKey(root, "");
      const command = hkcuShellKey(root, String.raw`\command`);

      if (enabled) {
        await reg(["add", command, "/ve", "/t", "REG_SZ", "/d", expected, "/f"]);

        await reg(["add", base, "/ve", "/t", "REG_SZ", "/d", VERB_LABEL, "/f"]);
        await reg(["add", base, "/v", "MUIVerb", "/t", "REG_SZ", "/d", VERB_LABEL, "/f"]);
        await reg(["add", base, "/v", "Icon", "/t", "REG_SZ", "/d", iconSource(), "/f"]);
      } else {
        await reg(["delete", base, "/f"]);
      }
    }

    log.info(`[shell-menu] 右键菜单项已${enabled ? "注册" : "移除"}`, {
      command: enabled ? expected : undefined,
      packaged: app.isPackaged,
    });

    if (enabled) {
      const after = await getContextMenuStatus();
      if (!after.valid) {
        log.error("[shell-menu] 注册后回读校验未通过:", after);
        return { success: false, error: after.reason ?? "注册后校验未通过" };
      }
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[shell-menu] ${enabled ? "注册" : "移除"}失败:`, err);
    return { success: false, error: message };
  }
}
