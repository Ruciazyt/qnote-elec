/**
 * 系统右键菜单集成（Windows）
 *
 * 目标：在资源管理器里右键任意文件 / 文件夹，多出一项
 * 「添加到 QNote 快捷方式」，点完直接把该项丢进主页快捷方式面板。
 *
 * ## 为什么是「注册表静态动词」而不是 shell 扩展 DLL
 *
 * 往右键菜单加项，正统做法是写一个 COM shell 扩展（IContextMenu + DLL），
 * 注册到 `*\shellex\ContextMenuHandlers`。代价是：需要编译 DLL、
 * 需要管理员权限装进系统目录、每次应用更新都得跟着重装。
 * 对"加一个快捷方式"这种需求完全不划算。
 *
 * 这里用的是**静态动词**：直接写 `HKCU\Software\Classes\<类目>\shell\<动词>\command`，
 * 资源管理器发现 command 就把它当菜单项执行。纯注册表、纯当前用户、
 * 免管理员、卸载时删几个键即可，是微软"扩展上下文菜单"一节里
 * 推荐的最小可行做法。
 *
 * ## 为什么坚持写在 HKCU 而不是 HKLM
 *
 * HKLM 需要管理员权限，装完还得管理员才能卸载。HKCU 只影响当前用户，
 * 普通权限就能装能卸，不给用户留下"想删却删不掉"的隐患。
 *
 * ## 开发模式也能用：关键是补上「应用入口路径」
 *
 * 开发模式下 `app.getPath("exe")` 是 electron.exe 而不是 QNote.exe。
 * 只把 exe 路径写进右键菜单的话，点一下会拉起一个**什么应用都没加载**的裸 Electron
 * —— 它不知道该跑哪个 main 脚本，只能报错退出。
 *
 * 但 Electron 官方的 `setAsDefaultProtocolClient` 早就解决过同一问题，办法是
 * 运行时判断 `process.defaultApp`：为 true（用 electron 二进制 + 应用路径启动）
 * 时，把应用路径作为**第二个参数**一并传给 exe。本模块照搬这个做法 ——
 * 注册的命令行与 `pnpm dev` 里 `electron ./dist/main/index.js` 完全等价，
 * 于是开发期点右键菜单能正常唤起当前这个实例。
 */
import { app } from "electron";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { log } from "./log";

const execFileAsync = promisify(execFile);

/** 动词的注册表键名。卸载时按同一个名字精确定位删除 */
const VERB_KEY = "QNoteAddShortcut";

/** 右键菜单上显示的文案 */
const VERB_LABEL = "添加到 QNote 快捷方式";

/**
 * 命令行开关：资源管理器用它把被右键的目标路径传进来
 *
 * 只支持 `--add-shortcut <path>` 和 `--add-shortcut=<path>` 两种写法，
 * 不用更宽松的"包含即匹配"：argv 里可能混进别的以 - 开头的参数，
 * 宽松匹配会误把无关参数当成目标路径。
 */
export const ADD_SHORTCUT_FLAG = "--add-shortcut";

/**
 * 登记的类目
 *
 * `*` 是任意文件、`Directory` 是文件夹。驱动器（Drive）没有一并登记：
 * 整块硬盘加进快捷方式没有实际意义，还会和"此电脑"的既有菜单打架。
 */
const REG_CLASS_ROOTS = ["*", "Directory"] as const;

/**
 * 注册进右键菜单的启动命令前缀（不含 --add-shortcut 和 %1）
 *
 * 打包版：`"QNote.exe"`
 * 开发版：`"electron.exe" "<项目>/dist/main/index.js"` —— 第二个参数是应用入口，
 *          少了它资源管理器只会拉起一个空壳 Electron。
 *
 * 路径必须整体加引号：装在 `C:\Program Files\` 下时路径含空格，
 * 不加引号的话资源管理器会把 `"C:\Program` 当可执行文件、
 * `Files\QNote.exe"` 当第一个参数，右键项直接失效。
 */
function launchPrefix(): { prefix: string; error?: string } {
  const exe = `"${app.getPath("exe")}"`;

  if (app.isPackaged) {
    return { prefix: exe };
  }

  // process.defaultApp 为 true 表示「用 electron 二进制 + 应用路径」启动的，
  // 此时 process.argv[1] 就是那个应用路径（开发脚本里是 ./dist/main/index.js）
  const appArg = process.defaultApp ? process.argv[1] : undefined;
  if (appArg && appArg.toLowerCase().endsWith(".js") && fs.existsSync(path.resolve(appArg))) {
    return { prefix: `${exe} "${path.resolve(appArg)}"` };
  }

  return {
    prefix: exe,
    error: "无法确定应用入口路径（process.argv[1] 不是可用的脚本）",
  };
}

/**
 * 右键菜单项显示的图标
 *
 * 开发模式下 exe 是 electron.exe，显示出来会让用户以为装了个 Electron 应用；
 * 这里改用项目自己的 resources/icon.ico。取不到再退回 exe。
 */
function iconSource(): string {
  if (!app.isPackaged) {
    try {
      // app.getAppPath() 在开发模式下是 <项目根>/dist/main
      const icon = path.join(app.getAppPath(), "..", "..", "resources", "icon.ico");
      if (fs.existsSync(icon)) return icon;
    } catch {
      /* 路径拼不出来就退回 exe 图标 */
    }
  }
  return `${app.getPath("exe")},0`;
}

function hkcuShellKey(root: string, sub: string): string {
  return `HKCU\\Software\\Classes\\${root}\\shell\\${VERB_KEY}${sub}`;
}

/**
 * 解析命令行里的 --add-shortcut 目标
 *
 * 两条到达路径都要覆盖：应用已运行时右键唤起（second-instance 转发 argv），
 * 以及应用未运行时直接启动（首次启动的 process.argv）。
 *
 * ## 为什么必须用 `--flag=value` 形式
 *
 * Electron **不会**把命令行原样透传。实测它会重排 argv：把自己注入的 Chromium
 * 开关（appendSwitch 加的那些）排在最前，随后是应用入口脚本，最后才是用户参数：
 *
 *   ["--add-shortcut", "--allow-file-access-from-files", "--secure-schemes=...",
 *    ..., "D:\\...\\dist\\main\\index.js", "C:\\Windows\\System32\\notepad.exe"]
 *
 * 于是 `--add-shortcut` 后面紧跟的是另一个开关，而不是它的值 —— 按「flag 后面
 * 那个就是路径」来解析永远拿不到目标。所以注册时写成 `--add-shortcut="%1"`，
 * 让值和开关绑在同一个 argv token 里，与位置无关。
 */
export function parseAddShortcutArg(argv: string[]): string | null {
  let sawFlag = false;

  // 主路径：值与开关绑在一起
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

  // 兜底：开关在但值被拆散了（不同 Electron 版本的重排行为不完全一致）。
  // 取最后一个既不是开关、又是 Windows 绝对路径的参数 —— 那正是资源管理器塞进去的。
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i];
    if (arg.startsWith("-")) continue;
    const value = stripQuotes(arg);
    if (/^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)) return value;
  }
  return null;
}

/** 去掉资源管理器可能带上的成对引号 */
function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * reg.exe 的输出在中文系统上是 GBK，解成 utf8 只会得到乱码，而这里根本不看内容
 *
 * 但 regCommandValue 要读 stdout（要看写入的命令值对不对），所以这里把
 * execFile 的输出原样带出来，不在解码上做文章 —— REG_SZ 之类的前缀是 ASCII，
 * 即使正文是乱码，正则照样能匹配上。
 */
async function reg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("reg.exe", args, {
    timeout: 10_000,
    windowsHide: true,
  });
  return { stdout, stderr };
}

/** 判断注册表键是否已存在 —— reg query 的返回码就是答案 */
async function regKeyExists(key: string): Promise<boolean> {
  try {
    await reg(["query", key]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取注册表里实际写入的命令值
 *
 * 返回值有三种含义，缺一不可：
 *   - null：command 键压根不存在（注册项写了一半）
 *   - ""  ：键在、但值是空的（写注册表时中途失败就会留下这种残缺项）
 *   - 字符串：真正写进去的命令
 *
 * 后两种在资源管理器里的表现**完全一样**：菜单项显示得出来，
 * 点下去什么都不会发生。所以必须把"空值"和"缺键"分开看。
 */
async function regCommandValue(commandKey: string): Promise<string | null> {
  try {
    const { stdout } = await reg(["query", commandKey, "/ve"]);
    const match = stdout.match(/REG_SZ\s+(.*)/);
    return match ? match[1].trim() : "";
  } catch {
    return null;
  }
}

/**
 * 当前这个应用**应该**注册进去的命令
 *
 * 资源管理器执行的就是这条命令，所以它必须指向当前正在运行的可执行文件。
 * 应用换了安装目录（升级、便携版挪了位置）之后，旧的注册项就指向了一个
 * 不存在的路径 —— 菜单项还在，点下去毫无反应。
 */
export function expectedContextMenuCommand(): { command: string; error?: string } {
  const { prefix, error } = launchPrefix();
  if (error) return { command: "", error };
  return { command: `${prefix} ${ADD_SHORTCUT_FLAG}="%1"` };
}

/** 实际注册的命令是否就是"应该写入的那条" */
function isCommandCurrent(actual: string | null): boolean {
  if (actual === null || actual.trim() === "") return false;
  const { command, error } = expectedContextMenuCommand();
  if (error) return false;
  return actual === command;
}

export interface ShellContextMenuStatus {
  supported: boolean;
  enabled: boolean;
  /**
   * 注册的命令是否指向当前这个应用
   *
   * enabled 只说明"键在"，valid 才说明"点下去真的有用"。
   * 两者不一致时（enabled=true, valid=false）菜单项会显示出来但毫无反应，
   * 界面必须如实告诉用户，而不是显示一个"已开启"的绿灯。
   */
  valid: boolean;
  /** 实际注册的命令（供界面展示与排查） */
  command?: string;
  /** supported 为假时的原因，直接显示给用户 */
  reason?: string;
}

/** 当前环境是否具备注册右键菜单的条件 */
export function contextMenuSupport(): { supported: boolean; reason?: string } {
  if (process.platform !== "win32") {
    return { supported: false, reason: "仅支持 Windows" };
  }
  // 开发模式同样支持，但必须能确定应用入口路径，否则写出去的命令拉不起应用
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

    // 两个类目都要核对：只修好一半的话，右键文件夹能用、右键文件还是死的
    const commands = await Promise.all(
      REG_CLASS_ROOTS.map((root) => regCommandValue(hkcuShellKey(root, "\\command")))
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

/**
 * 自愈：注册项在、但命令已经失效时，把它重写成当前这条
 *
 * 典型场景：
 *   - 应用升级后换了安装目录，旧命令还指着上一个路径
 *   - 旧版本残留的注册项还在，命令格式是老的（甚至值是空的）
 *   - 写注册表写到一半失败，留下"菜单项在、命令为空"的残缺状态
 *
 * 这三种在资源管理器里的表现都是"右键有这一项、点了没反应"，
 * 而应用原先只看键在不在，永远发现不了。
 *
 * 只修"用户已经开启"的情况 —— 用户主动关掉的右键菜单不该被擅自打开。
 */
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
    // 用户没开这个功能，保持现状
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

/** 写入 / 移除右键菜单项 */
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
      const command = hkcuShellKey(root, "\\command");

      if (enabled) {
        // 命令先写、标签后写。
        //
        // 顺序反过来（先写标签再写命令）时，中途失败/被杀会留下
        // "菜单项已经显示、命令却是空的"这种残缺状态 ——
        // 在资源管理器里点下去毫无反应，而应用只看标签在不在，
        // 会一直以为注册成功了。命令写好了菜单项才有意义，所以它排第一。
        //
        // %1 由资源管理器替换成被右键项的完整路径（自带引号）
        await reg(["add", command, "/ve", "/t", "REG_SZ", "/d", expected, "/f"]);

        // MUIVerb 与默认值同时写：MUIVerb 让 Win11 的新版右键菜单正确显示
        // 本地化文案，缺省值则保证旧版资源管理器也能显示出来。
        await reg(["add", base, "/ve", "/t", "REG_SZ", "/d", VERB_LABEL, "/f"]);
        await reg(["add", base, "/v", "MUIVerb", "/t", "REG_SZ", "/d", VERB_LABEL, "/f"]);
        await reg(["add", base, "/v", "Icon", "/t", "REG_SZ", "/d", iconSource(), "/f"]);
      } else {
        // 删掉 shell\QNoteAddShortcut 整个键会连同下面的 command 一起带走
        await reg(["delete", base, "/f"]);
      }
    }

    log.info(`[shell-menu] 右键菜单项已${enabled ? "注册" : "移除"}`, {
      command: enabled ? expected : undefined,
      packaged: app.isPackaged,
    });

    // 写完必须回读一次：注册表写入不报错不代表内容是对的，
    // 而"命令为空"的残缺项在资源管理器里表现为"点了没反应"，极难自查。
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
