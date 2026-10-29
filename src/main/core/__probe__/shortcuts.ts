import { globalShortcut } from "electron";
import { log } from "../utils/log";

type VoidFn = () => void;

/**
 * 注册全局快捷键
 * macOS: Command+Shift+V
 * Windows/Linux: CommandOrControl+Shift+V
 *
 * AI 弹窗的快捷键（Command+Shift+A）已随 popup AI 一起移除 ——
 * 浮框面板 / 主窗口的 AI 助手仍然可用，但不再有独立小窗入口。
 * 该键位如今由语音输入复用，见 registerVoiceShortcut。
 */
export function registerGlobalShortcuts(
  onClipboard: VoidFn,
  /** 保留参数以避免改动调用方签名；当前 no-op（popup AI 已移除） */
  _onAi: VoidFn
): void {
  const isMac = process.platform === "darwin";
  const clipboardKey = isMac ? "Command+Shift+V" : "CommandOrControl+Shift+V";

  if (globalShortcut.register(clipboardKey, onClipboard)) {
    log.info(`✓ [shortcuts] 注册成功: ${clipboardKey} → 剪贴板小窗`);
  } else {
    log.warn(`✗ [shortcuts] 注册失败: ${clipboardKey}（已被占用）→ 剪贴板小窗`);
    if (isMac) {
      log.warn("[shortcuts] macOS 用户请在系统偏好设置 → 隐私 → 辅助功能 中授权 QNote");
    }
  }
}

/** Electron 支持的修饰键（小写比较）。除此之外的任何 token 都会被解析器静默丢弃。 */
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

/** 常见非字符按键的合法写法 */
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

/** 裸的功能键（F1~F24）：允许不带修饰键 */
const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/;
/** 裸的单个字母 / 数字 */
const BARE_CHAR_KEY = /^[a-z0-9]$/;

export interface AcceleratorCheck {
  ok: boolean;
  /** 面向用户的中文说明；ok 为 true 时无此字段 */
  error?: string;
}

/**
 * 校验一个 accelerator 字符串是否可以交给 globalShortcut
 *
 * ## 为什么必须在注册前校验，而不是靠 register() 的返回值
 *
 * 实测（Windows / Electron 33）发现一个危险的静默降级：
 *
 *     globalShortcut.register("fn+1", …)  → 返回 true（看起来完全正常）
 *     globalShortcut.isRegistered("1")    → true（它其实注册的是裸 "1"）
 *     globalShortcut.register("1", …)     → false（同一组合已被占用）
 *
 * 也就是说 accelerator 解析器会**丢弃它不认识的修饰键**，`fn+1` 被当成 `1`。
 * 如果照字面实现，用户在应用里敲任何一个数字 1 都会触发语音输入，
 * 而注册过程一声不吭。根因是 `fn` 由键盘固件/驱动层拦截，压根不会送达应用，
 * Electron 也没有 fn 这个修饰键概念。
 *
 * 所以这里显式维护修饰键白名单：出现白名单外的 token 就直接拒绝，
 * 不给「静默丢弃」留任何机会。
 */
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
            "若笔记本已把 Fn+1 映射为功能键，请改填 F1。",
        };
      }
      return {
        ok: false,
        error: `无法识别的修饰键「${modifier}」。可用：Ctrl / Alt / Shift / Command / CommandOrControl。`,
      };
    }
  }

  const lowerKey = last.toLowerCase();
  const isFunctionKey = FUNCTION_KEY.test(lowerKey);
  const isNamedKey = NAMED_KEYS.has(lowerKey);
  const isBareChar = BARE_CHAR_KEY.test(lowerKey);
  const isAlphanumeric =
    /^[a-z0-9]$/i.test(last) || /^[!-\/:-@\[-`{-~]$/.test(last);

  if (!isFunctionKey && !isNamedKey && !isAlphanumeric) {
    return { ok: false, error: `无法识别的按键「${last}」` };
  }

  // 不带修饰键的裸字符键会**全局**抢占正常打字，不能接受。
  // 功能键（F1~F24）是这类例外：用户按它本来就不指望打出字符，
  // 而且笔记本上的 Fn+1 正是被驱动映射成 F1 送到系统的。
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

/** 当前已注册的语音快捷键；用于改配置时先注销旧的 */
let registeredVoiceAccelerator: string | null = null;

/** 供调用方查询当前生效的语音快捷键（排查"按了没反应"时用） */
export function getRegisteredVoiceAccelerator(): string | null {
  return registeredVoiceAccelerator;
}

/**
 * 注册语音输入快捷键
 *
 * @param accelerator 用户配置的 accelerator（已通过 validateAccelerator）
 * @param onTrigger   触发回调
 * @returns 注册结果。ok=false 时 error 说明原因（多为被其它软件占用）
 */
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
    /* ignore */
  }
  registeredVoiceAccelerator = null;
}

export function unregisterAllShortcuts(): void {
  unregisterVoiceShortcut();
  globalShortcut.unregisterAll();
  log.info("[shortcuts] 所有快捷键已注销");
}
