import { globalShortcut } from "electron";
import { log } from "../utils/log";

type VoidFn = () => void;

/**
 * 剪贴板面板的全局快捷键 —— 用户可在设置页自定义
 *
 * 这里刻意不做任何「按平台挑组合」的硬编码：组合由用户在设置页填，
 * 存在数据库里，启动时读出来注册。默认值见 config.ts 的
 * DEFAULT_CLIPBOARD_PANEL_HOTKEY。
 *
 * ## 为什么不用固定的 Win+C
 *
 * Windows 11 把 Win+C 绑给了 Copilot，RegisterHotKey 抢不过系统保留键，
 * 注册会直接失败（失败只返回 false，不抛异常）。
 *
 * ## 为什么也不支持 Fn 键
 *
 * Electron 的 accelerator 修饰键只有
 * Command / Control / CommandOrControl / Alt / Option / AltGr / Shift / Super / Meta，
 * **没有 Fn**。而 Fn 键在 Windows 上由键盘固件和驱动在很低的层就消费掉了，
 * 根本不会作为修饰键送到应用。
 *
 * 更糟的是解析器对不认识的修饰键是**静默丢弃**而不是报错：
 * 实测 `globalShortcut.register("fn+1", …)` 返回 true（看着像注册成功了），
 * 实际注册的是裸的 "1" —— 用户在任何一个输入框里敲数字 1 都会触发。
 * 所以 Fn 组合一律在 validateAccelerator 里直接拒掉。
 *
 * 想知道自己的键盘上 Fn+C 到底被驱动送成了什么，可以在设置页试填
 * 那个组合：填 Fn+C 会被明确拒绝，填 F 开头或媒体键能注册上就说明驱动
 * 是那样映射的。
 */

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
            "若笔记本已把 Fn 组合映射成功能键，请改填那个功能键（如 F1 / F9）。",
        };
      }
      // "Win" 是 Windows 用户最自然的写法，但它不是 Electron 的修饰键名 ——
      // 解析器会**静默丢弃**它，剩下的裸键被全局注册（"Win+C" 实际变成抢占裸 C）。
      // 所以这里明确告诉用户正确写法，而不是只说"不认识"。
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

/** 当前已注册的剪贴板面板快捷键；用于改配置时先注销旧的 */
let registeredPanelAccelerator: string | null = null;

/** 供调用方查询当前生效的面板快捷键（设置页回显、排查"按了没反应"时用） */
export function getRegisteredPanelAccelerator(): string | null {
  return registeredPanelAccelerator;
}

/**
 * 注册剪贴板面板快捷键
 *
 * 与语音快捷键同一套逻辑：先校验语法，再交给系统注册，
 * 两者都如实回报结果（ok / error），由调用方决定要不要回滚配置。
 *
 * @param accelerator 用户配置的 accelerator（已通过 validateAccelerator）
 * @param onTrigger   触发回调
 * @returns 注册结果。ok=false 时 error 说明原因（多为被其它软件占用）
 */
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
    /* ignore */
  }
  registeredPanelAccelerator = null;
}

export function unregisterAllShortcuts(): void {
  unregisterVoiceShortcut();
  unregisterClipboardPanelShortcut();
  globalShortcut.unregisterAll();
  log.info("[shortcuts] 所有快捷键已注销");
}
