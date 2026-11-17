import { globalShortcut } from "electron";
import { log } from "../system/log";

type VoidFn = () => void;


const SUPPORTED_MODIFIERS = new Set([
  "command",
  "cmd",
  "commandorcontrol",
  "cmdorctrl",
  "control",
  "ctrl",
  "super",
  "meta",
  "alt",
  "option",
  "altgr",
  "shift",
]);

const NAMED_KEYS = new Set([
  "space",
  "spacebar",
  "tab",
  "backspace",
  "delete",
  "del",
  "insert",
  "return",
  "enter",
  "esc",
  "escape",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "printscreen",
  "plus",
  "numlock",
  "scrolllock",
]);

const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/;

export interface AcceleratorCheck {
  ok: boolean;
  error?: string;
}

export function validateAccelerator(accelerator: string): AcceleratorCheck {
  const raw = (accelerator || "").trim();
  if (!raw) {
    return { ok: false, error: "快捷键不能为空" };
  }

  const tokens = raw.split("+").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, error: "快捷键不能为空" };
  }

  const last = tokens[tokens.length - 1];
  const modifiers = tokens.slice(0, -1);

  for (const modifier of modifiers) {
    const lower = modifier.toLowerCase();
    if (!SUPPORTED_MODIFIERS.has(lower)) {
      if (lower === "fn") {
        return {
          ok: false,
          error:
            "Electron 不支持 fn 键 —— 它被键盘驱动拦截、不会送到应用。" +
            "若笔记本已把 Fn 组合映射成功能键，请改填那个功能键（如 F1 / F9）。",
        };
      }
      if (lower === "win") {
        return {
          ok: false,
          error: "Win 键在 Electron 里叫 Super，请改填 Super+C。",
        };
      }
      return {
        ok: false,
        error: `无法识别的修饰键「${modifier}」。可用：Ctrl / Alt / Shift / Super（Win 键）/ Command / CommandOrControl。`,
      };
    }
  }

  const lowerKey = last.toLowerCase();
  const isFunctionKey = FUNCTION_KEY.test(lowerKey);
  const isNamedKey = NAMED_KEYS.has(lowerKey);
  const isAlphanumeric =
    /^[a-z0-9]$/i.test(last) || /^[!-/:-@[-`{-~]$/.test(last);

  if (!isFunctionKey && !isNamedKey && !isAlphanumeric) {
    return { ok: false, error: `无法识别的按键「${last}」` };
  }

  if (modifiers.length === 0 && !isFunctionKey && !isNamedKey) {
    return {
      ok: false,
      error:
        `「${last}」没有修饰键，会在全局抢占正常输入的按键。` +
        "请加上 Ctrl / Alt / Shift，或改用 F1~F24 这类功能键。",
    };
  }

  return { ok: true };
}

let registeredVoiceAccelerator: string | null = null;

export function getRegisteredVoiceAccelerator(): string | null {
  return registeredVoiceAccelerator;
}

export function registerVoiceShortcut(
  accelerator: string,
  onTrigger: VoidFn
): AcceleratorCheck {
  unregisterVoiceShortcut();

  const check = validateAccelerator(accelerator);
  if (!check.ok) {
    return check;
  }

  try {
    const ok = globalShortcut.register(accelerator, onTrigger);
    if (!ok) {
      const message = `快捷键「${accelerator}」注册失败，可能已被其它程序占用`;
      log.warn(`✗ [shortcuts] ${message}`);
      return { ok: false, error: message };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const message = `快捷键「${accelerator}」注册出错：${reason}`;
    log.warn(`✗ [shortcuts] ${message}`);
    return { ok: false, error: message };
  }

  registeredVoiceAccelerator = accelerator;
  log.info(`✓ [shortcuts] 注册成功: ${accelerator} → 语音输入`);
  return { ok: true };
}

export function unregisterVoiceShortcut(): void {
  if (!registeredVoiceAccelerator) return;
  try {
    globalShortcut.unregister(registeredVoiceAccelerator);
    log.info(`[shortcuts] 已注销语音快捷键: ${registeredVoiceAccelerator}`);
  } catch {
  }
  registeredVoiceAccelerator = null;
}

let registeredPanelAccelerator: string | null = null;

export function getRegisteredPanelAccelerator(): string | null {
  return registeredPanelAccelerator;
}

export function registerClipboardPanelShortcut(
  accelerator: string,
  onTrigger: VoidFn
): AcceleratorCheck {
  unregisterClipboardPanelShortcut();

  const check = validateAccelerator(accelerator);
  if (!check.ok) {
    return check;
  }

  try {
    const ok = globalShortcut.register(accelerator, onTrigger);
    if (!ok) {
      const message = `快捷键「${accelerator}」注册失败，可能已被其它程序占用`;
      log.warn(`✗ [shortcuts] ${message} → 剪贴板面板`);
      return { ok: false, error: message };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const message = `快捷键「${accelerator}」注册出错：${reason}`;
    log.warn(`✗ [shortcuts] ${message} → 剪贴板面板`);
    return { ok: false, error: message };
  }

  registeredPanelAccelerator = accelerator;
  log.info(`✓ [shortcuts] 注册成功: ${accelerator} → 剪贴板面板`);
  return { ok: true };
}

export function unregisterClipboardPanelShortcut(): void {
  if (!registeredPanelAccelerator) return;
  try {
    globalShortcut.unregister(registeredPanelAccelerator);
    log.info(`[shortcuts] 已注销剪贴板面板快捷键: ${registeredPanelAccelerator}`);
  } catch {
  }
  registeredPanelAccelerator = null;
}

export function unregisterAllShortcuts(): void {
  unregisterVoiceShortcut();
  unregisterClipboardPanelShortcut();
  globalShortcut.unregisterAll();
  log.info("[shortcuts] 所有快捷键已注销");
}
