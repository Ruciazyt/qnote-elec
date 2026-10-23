import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  nativeImage,
} from "electron";
import * as path from "node:path";
import { migrateRun } from "../database/migrations";
import { clipboardListener, stopClipboardListener } from "./core/clipboardListener";
import { FileWriter } from "./core/fileWriter";
import { floatingPanelStore } from "./core/floatingPanel";
import { getDB, closeDB } from "../database";
import { log, installStdoutGuard } from "./utils/log";
import * as fs from "fs";
import { setBaiduKeys } from "./utils/baiduOCR";
import { configManager, DEFAULT_VOICE_HOTKEY } from "./utils/config";
import { vectorStore } from "./utils/vectorStore";
import { initSettingsStore } from "./utils/settingsStore";
import { registerFileHandlers } from "./handlers/fileHandlers";
import { registerNoteHandlers } from "./handlers/noteHandlers";
import { registerTemplateHandlers } from "./handlers/templateHandlers";
import { registerOcrHandlers } from "./handlers/ocrHandlers";
import { registerConfigHandlers } from "./handlers/configHandlers";
import { registerAiHandlers } from "./handlers/aiHandlers";
import { registerVectorHandlers } from "./handlers/vectorHandlers";
import { registerLeetcodeHandlers } from "./handlers/leetcodeHandlers";
import { registerDatabaseTransferHandlers } from "./handlers/databaseTransferHandlers";
import { registerClipboardPopupHandlers } from "./handlers/clipboardPopupHandlers";
import { registerNotesProtocol } from "./handlers/notesProtocol";
import { registerTodoHandlers } from "./handlers/todoHandlers";
import { registerBrowserHandlers, teardownBrowserHandlers } from "./handlers/browserHandlers";
import { registerBookmarkHandlers } from "./handlers/bookmarkHandlers";
import { registerShortcutHandlers } from "./handlers/shortcutHandlers";
import { parseAddShortcutArg } from "./utils/shellContextMenu";
import { registerAsrHandlers } from "./handlers/asrHandlers";
import { createMainWindow, getMainWindow, showMainWindow, createTray, createCircleWindow, destroyCircleWindow } from "./core/window";
import { ClipboardPopupWindow } from "./core/window/clipboardPopup";
import { registerGlobalShortcuts, unregisterAllShortcuts, registerVoiceShortcut, validateAccelerator, getRegisteredVoiceAccelerator } from "./core/shortcuts";

// ---------------------------------------------------------------------------
// 单实例锁 —— 必须在任何 app.* 副作用之前获取
//
// 为什么必需：electron-reloader 的热重载实现是 `app.relaunch() + app.exit(0)`，
// 而 app.relaunch() 会**再拉起一个完整的应用实例**。开发模式下 tsc -w 每次启动
// 都会重写 dist/main 下的全部编译产物，于是"重编译"和"多开实例"实际是同一件事：
// 每个还活着的实例都会各自拉起一个新实例；再叠加上一次 dev 遗留的孤儿实例
// （Ctrl+C 只结束 concurrently / tsc / vite，被 relaunch 出来、已经脱离进程树的
// electron 不会被杀），数量只增不减。实测一次 pnpm dev 会在 7.5 秒内连开 5 个。
//
// 没有这把锁时，多开毫无阻碍：每个实例独立开一个托盘、一条 SQLite 连接连同一个
// 开发库、抢同一批全局快捷键和 CDP 端口，只有第一个抢得到，其余静默失败。
// 打包版同样需要 —— 用户双击两次图标就会得到两个实例、两个托盘图标。
// ---------------------------------------------------------------------------
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // 已经有实例在跑了，本次启动是多余的：不建窗口、不注册 handler，直接退出。
  app.exit(0);
} else {
  // 后启动的实例（含 reloader relaunch 拉起的那些）把焦点交回先启动的那个，
  // 而不是各自开一个一模一样的新应用。
  //
  // **argv 必须转发**：系统右键菜单里的「添加到 QNote 快捷方式」是以
  // `QNote.exe --add-shortcut "路径"` 的方式启动本应用的。应用已在运行时，
  // 这次启动会被单实例锁拦下、argv 只出现在这里 —— 不转发的话，
  // 用户在资源管理器里点右键菜单不会有任何反应。
  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    dispatchAddShortcutArg(argv);
  });
}

/**
 * 把命令行里的 --add-shortcut 目标转交给渲染层
 *
 * 渲染层收到后弹「添加到快捷方式」确认框。确认这一步不能省：右键菜单是
 * 高频误触区域，静默添加会让用户莫名其妙多出一堆快捷方式却不知道怎么删。
 *
 * 窗口还没加载完时不能直接 send —— 渲染层的监听器尚未注册，
 * 这条消息会永久丢失且不报错。改挂一次性的 did-finish-load。
 */
function dispatchAddShortcutArg(argv: string[]): void {
  const target = parseAddShortcutArg(argv);
  // 这条日志是这类功能唯一的排障入口：用户报"点了右键菜单没反应"时，
  // 只有 argv 能区分「资源管理器没调用我们」「传过来的路径是空的」
  // 和「窗口当时不可用」这三种完全不同的环节。
  log.info("[shortcut] 收到启动参数", { argv: argv.slice(1), target });
  if (!target) return;

  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    log.warn("[shortcut] 收到添加请求但主窗口不存在，忽略:", target);
    return;
  }

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) win.webContents.send("shortcut:external-add", target);
    });
  } else {
    win.webContents.send("shortcut:external-add", target);
  }
}

// 先把 stdout/stderr 的写错误兜住，再让任何代码有机会往控制台打日志。
// 终端或 concurrently 的管道一旦断开，console.* 会抛 EPIPE；没有这个守卫时，
// EPIPE 会变成未捕获异常 → 日志系统 → console.error → EPIPE，进程空转刷爆日志文件。
installStdoutGuard();

// 设置开发环境
//
// 必须排在热重载判断**之前**：原来这句在 electron-reloader 守卫下面，
// 而 pnpm dev 全链路没有任何地方设 NODE_ENV（只有 build 脚本用 cross-env 设
// production），于是守卫读到 undefined、恒为 false，electron-reloader 从来没被
// 加载过 —— 主进程改代码不热重载，一直是靠手动重启在掩盖。
process.env.NODE_ENV = process.env.NODE_ENV || "development";

// 开发环境下启用主进程热重载
//
// app.isPackaged 才是"是不是打包版"的权威判断；NODE_ENV 只是叠加条件。
// electron-reloader 是 devDependency，打包产物里根本没有，必须靠 !app.isPackaged 挡住。
//
// watchRenderer 必须为 false。源码 index.js:58 是
//     const watchPaths = options.watchRenderer ? cwd : [...mainProcessPaths];
// 打开它会把监听范围从"主进程实际 require 的模块"扩大到**整个项目根目录**，
// 而 change 回调里非主进程文件走的是 webContents.reloadIgnoringCache() ——
// 也就是每改一个 .tsx 都会额外触发一次全量重载，和 Vite HMR 打架、
// 把组件状态全部丢掉。关掉之后只监听主进程模块，改动时自动重启；
// 渲染层交给 Vite HMR，两者不再互相干扰。
//
// 还要叠加 hasSingleInstanceLock：reloader 本身就是"拉起新实例"的来源，
// 第二个实例绝不能再去武装 watcher，否则它退出前也可能再拉起一个。
try {
  if (hasSingleInstanceLock && !app.isPackaged && process.env.NODE_ENV === "development") {
    require("electron-reloader")(module, {
      debug: true,
      watchRenderer: false,
    });
  }
} catch (err) {
  log.error("热重载设置失败:", err);
}

/**
 * CDP 远程调试端口 —— 仅开发环境开启
 *
 * 为什么必须限开发环境：实测确认这个端口能完整操控内嵌浏览器 ——
 * /json/list 会把 WebContentsView 当作标准 page target 暴露，attach 之后
 * Runtime.evaluate 可读页面、DOM 查询可枚举元素、还能真实点击和输入。
 * 而内嵌浏览器用的是 persist:qnote-browser 持久化分区，
 * 里面是用户各网站的登录 cookie。一旦发布版开放该端口，
 * 任何本机进程连上 127.0.0.1:9222 就等于拿到已登录的浏览器控制权。
 *
 * 调试打包版时可通过环境变量显式开启：QNOTE_REMOTE_DEBUG_PORT=9222
 */
if (!app.isPackaged || process.env.QNOTE_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.QNOTE_REMOTE_DEBUG_PORT || "9222"
  );
} else {
  // 注意：此处处于模块加载期，log.initialize() 尚未调用（app.whenReady 内才初始化），
  // 用 console 保证能看到，但不指望它进日志文件。
  console.warn(
    "[qnote] 打包环境已禁用 CDP 远程调试端口（如需调试打包版请设 QNOTE_REMOTE_DEBUG_PORT=9222）"
  );
}

app.commandLine.appendSwitch("disable-features", "Autofill");

/**
 * 启用网页内容的 overlay 滚动条
 *
 * 应用自身的滚动条由 index.css 控制（细、滚动时才显示），但内嵌浏览器
 * WebContentsView 里加载的网页属于 Blink 内容，CSS 管不到，只能靠这个开关。
 *
 * Chromium 源码 ui/native_theme/native_theme_features.cc：
 *   kOverlayScrollbar —— "Enables or disables overlay scrollbars in Blink
 *                        (i.e. web content) on Aura or Linux"，桌面端默认关闭。
 * 打开后网页滚动条变为悬浮式，静止时隐藏、不再挤占页面宽度。
 *
 * 注意：appendSwitch 会整体替换同名开关的值，所以先读出已有的再合并，
 * 避免把 Electron / 其它地方已设置的 enable-features 冲掉。
 */
const existingFeatures = app.commandLine.getSwitchValue("enable-features");
app.commandLine.appendSwitch(
  "enable-features",
  existingFeatures ? `${existingFeatures},OverlayScrollbar` : "OverlayScrollbar"
);

let tray: Tray | null = null;
let DB: any;
let fileWriter: FileWriter;
let isQuitting = false;

function getAssetsDir() {
  return !app.isPackaged
    ? path.join(app.getAppPath(), "..", "..", "resources")
    : path.join(process.resourcesPath, "resources");
}

function getAssetDirs() {
  if (app.isPackaged) {
    return [getAssetsDir()];
  }

  return [
    getAssetsDir(),
    path.join(app.getAppPath(), "..", "..", "src", "renderer", "public"),
  ];
}

function resolveAssetPath(fileName: string) {
  return path.join(getAssetsDir(), fileName);
}

/**
 * 语音快捷键被按下 —— 唤出主窗口（不展开 AI 对话框）后通知渲染层开始/结束录音
 *
 * ## 为什么执行在渲染进程
 *
 * 全局热键只在主进程这一侧注册，但麦克风采集、MediaRecorder、Web Audio 解码
 * 全是 DOM 侧的能力，主进程碰不到。所以主进程只负责「什么时候该录」，
 * 真正干活的是主窗口里的渲染层（收到 voice-hotkey:triggered 后自行切换录音状态）。
 *
 * 定义在模块作用域而非 registerWindowScopedHandlers 内部：
 * 启动时要注册一次、设置页改配置时要重新注册，两处都得能引用它。
 */
function triggerVoiceInput(): void {
  const mainWin = getMainWindow();
  if (!mainWin || mainWin.isDestroyed()) {
    log.warn("[voice] 主窗口不存在，忽略快捷键");
    return;
  }
  // 宠物和语音气泡都活在主窗口里。窗口隐藏到托盘/最小化时用户看不见宠物，
  // 录音会以"没有任何反馈"的形式进行 —— 所以先把窗口唤回前台。
  // 注意这只是显示主窗口，**不**展开 AI 对话框。
  const wasHidden = !mainWin.isVisible() || mainWin.isMinimized();
  if (wasHidden) {
    showMainWindow();
  }
  // "按了快捷键却毫无反应"是这类功能最常见的报障，而它可能发生在
  // 快捷键没注册、被别的软件抢走、窗口没唤出等完全不同的环节。
  // 留下这条日志，报障时看一眼就知道主进程到底有没有收到按键。
  log.info("[voice] 快捷键触发", {
    accelerator: getRegisteredVoiceAccelerator(),
    restoredWindow: wasHidden,
  });
  mainWin.webContents.send("voice-hotkey:triggered");
}

function resolveFirstExistingAsset(filenames: string[]): string | null {
  for (const name of filenames) {
    for (const dir of getAssetDirs()) {
      const assetPath = path.join(dir, name);
      if (fs.existsSync(assetPath)) {
        return assetPath;
      }
    }
  }
  return null;
}

// 注册所有IPC处理程序
/**
 * 注册所有 IPC 处理程序
 *
 * 分两段是因为时机要求不同：
 *   - 大部分 handler 只依赖 DB / fileWriter，与窗口无关，可以提前注册，
 *     避免窗口先loadURL 发出一批 IPC 却找不到 handler
 *     （"No handler registered for 'xxx'"，只在启动瞬间出现，很难定位）
 *   - browser_* 依赖 win 挂载 WebContentsView，必须等窗口建好
 *
 * 所以拆成 registerIpcHandlers() + registerWindowScopedHandlers()，
 * 由调用方按顺序触发。
 */
function registerIpcHandlers() {
  // 注册各个功能模块的handlers（不依赖窗口句柄的部分）
  //
  // 文件类 handler 里的对话框是在**调用时**才 getMainWindow()，所以放这里
  // 提前注册是安全的。曾经传 getMainWindow() 进来当参数，那会在窗口创建前
  // 拿到 null 并快照下来，导致「切换笔记目录」「插入图片」两个对话框静默失效。
  registerFileHandlers(fileWriter);
  registerNoteHandlers(DB);
  registerTemplateHandlers(DB);
  registerOcrHandlers(DB);
  registerConfigHandlers();
  registerAiHandlers(DB, fileWriter);
  registerVectorHandlers(DB);
  registerLeetcodeHandlers(DB);
  registerClipboardPopupHandlers();
  registerTodoHandlers(DB);
  registerBookmarkHandlers(DB);
  registerShortcutHandlers(DB);
  registerAsrHandlers();
}

/** 必须在 createMainWindow() 之后调用 —— 下面这些 handler 要用 win 挂载原生视图 */
function registerWindowScopedHandlers() {
  const win = getMainWindow();
  registerDatabaseTransferHandlers(DB, win);
  // 内嵌浏览器 — 需要 win 挂载 WebContentsView
  registerBrowserHandlers(win);

  // 跨窗口共享：AI 浮框位置 / 展开状态
  // 任一窗口修改 → 主进程存储 → 广播给其他窗口同步
  const broadcastToOthers = (
    senderId: number,
    channel: string,
    payload: unknown
  ) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.id !== senderId && !w.isDestroyed()) {
        w.webContents.send(channel, payload);
      }
    }
  };

  ipcMain.handle("floating-ai:get-state", () => {
    return floatingPanelStore.getState();
  });

  ipcMain.on(
    "floating-ai:set-position",
    (event, position: { right: number; bottom: number }) => {
      floatingPanelStore.setPosition(position);
      broadcastToOthers(
        event.sender.id,
        "floating-ai:position-updated",
        floatingPanelStore.getPosition()
      );
    }
  );

  ipcMain.on("floating-ai:set-expanded", (event, expanded: boolean) => {
    floatingPanelStore.setExpanded(expanded);
    broadcastToOthers(
      event.sender.id,
      "floating-ai:expanded-updated",
      floatingPanelStore.getState().expanded
    );
  });

  // ============================================================
  // 语音输入快捷键
  // ============================================================

  ipcMain.handle("voice:get-hotkey", async () => {
    try {
      const accelerator = await configManager.getVoiceHotkey();
      return { ok: true, accelerator };
    } catch (err) {
      log.error("[voice] 读取语音快捷键失败", err);
      return { ok: false, error: "读取语音快捷键失败" };
    }
  });

  ipcMain.handle("voice:set-hotkey", async (_event, accelerator: string) => {
    // 先做语法校验再落库 —— 不然一个写错的组合会被存进去，
    // 之后每次启动都注册失败，而用户根本不知道自己存了什么。
    const check = validateAccelerator(accelerator);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    try {
      await configManager.setVoiceHotkey(accelerator);
    } catch (err) {
      log.error("[voice] 保存语音快捷键失败", err);
      return { ok: false, error: "保存失败" };
    }
    // 配置存下来了，但系统热键可能已被别的程序占着 —— 把真实结果回传，
    // 让设置页能如实告诉用户"存了但没生效"，而不是假装一切正常。
    const result = registerVoiceShortcut(accelerator, triggerVoiceInput);
    if (!result.ok) {
      // 回滚到默认组合，并同步写回存储。
      // 不能只改内存：否则数据库里留着一个永远注册失败的组合，
      // 每次启动都会走一遍同样的失败，而用户界面显示的却是"已保存"。
      await configManager.setVoiceHotkey(DEFAULT_VOICE_HOTKEY);
      const fallback = registerVoiceShortcut(DEFAULT_VOICE_HOTKEY, triggerVoiceInput);
      if (fallback.ok) {
        return {
          ok: false,
          error: `${result.error}。已恢复为默认快捷键 ${DEFAULT_VOICE_HOTKEY}`,
        };
      }
      return { ok: false, error: `${result.error}，且默认快捷键也注册失败` };
    }
    return result;
  });

  ipcMain.handle("open-external", async (_event, url: string) => {
    if (!url) {
      return false;
    }
    // Validate URL scheme to prevent javascript:, file://, and other dangerous schemes
    try {
      const parsed = new URL(url);
      const allowed = ["https:", "http:", "mailto:"];
      if (!allowed.includes(parsed.protocol)) {
        log.warn("open-external blocked unsafe URL scheme:", { url, protocol: parsed.protocol });
        return false;
      }
      await shell.openExternal(url);
      return true;
    } catch (err) {
      log.error("打开外部链接失败", { url, err });
      return false;
    }
  });
}

// 设置全局未捕获异常处理
//
// 这里必须防重入：处理函数内部调用的日志链路如果再抛一次异常，Node 会把新的异常
// 继续交给 uncaughtException，于是形成 自递归 → 每个 tick 刷两份日志文件。
// 一次 EPIPE 自递归曾把 app.log / app-error.log 写到合计 18.8GB。
let handlingFatal = false;
process.on('uncaughtException', (error) => {
  if (handlingFatal) return;
  handlingFatal = true;
  try {
    log.error('未捕获的异常', error);
  } finally {
    handlingFatal = false;
  }
});

process.on('unhandledRejection', (reason) => {
  if (handlingFatal) return;
  handlingFatal = true;
  try {
    log.error('未处理的Promise拒绝', reason);
  } finally {
    handlingFatal = false;
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  unregisterAllShortcuts();
  stopClipboardListener();
  closeDB(); // 关闭数据库连接

  // 销毁所有弹出窗口
  const clipboardPopup = ClipboardPopupWindow.getInstance();
  clipboardPopup.destroy();

  // 销毁圆形控件窗口
  destroyCircleWindow();

  // 释放内嵌浏览器的 WebContentsView
  teardownBrowserHandlers();

  tray?.destroy();
  tray = null;
});

app.on("window-all-closed", () => {
  app.quit();
});

app
  .whenReady()
  .then(async () => {
    // 兜底：模块顶部已经 app.exit(0) 掉了，这里保证第二个实例绝不会建窗口、
    // 绝不会打开数据库、绝不会注册 tray/快捷键。
    if (!hasSingleInstanceLock) return;

    if (process.platform === "win32") {
      app.setAppUserModelId("com.ruciazyt.qnote");
    }

    // 初始化日志系统
    log.initialize();
    log.info('应用程序启动中...');

    // 根据环境确定数据库路径
    try {
      const userDataPath = app.getPath('userData');
      log.info("userData路径:", userDataPath);

      // 默认笔记目录：<userData>/notes
      //
      // 目录名曾是 whiteboard（早期只存 Excalidraw 白板），后来笔记系统
      // 扩展出文本 / 网页 / 图片 / PDF，"白板"已经名不副实。统一成 notes。
      // 改名不影响已有用户 —— file_path 存在 settings 表里，值是绝对路径，
      // 改默认值只对尚未初始化过的新用户生效。
      const defaultNotesDir = path.join(userDataPath, "notes");
      if (!fs.existsSync(defaultNotesDir)) {
        try {
          fs.mkdirSync(defaultNotesDir, { recursive: true });
          log.info("默认笔记目录已创建:", defaultNotesDir);
        } catch (mkdirErr) {
          log.error("创建默认笔记目录失败:", mkdirErr);
        }
      }

      // 确保图标文件存在
      const assetPath = getAssetsDir();
      log.info("资源文件路径:", assetPath);

      // 检查图标文件是否存在
      const iconFile = resolveFirstExistingAsset(["icon.ico"]) ?? path.join(assetPath, "icon.ico");
      const circleHtmlFile = path.join(assetPath, "circle.html");

      if (!fs.existsSync(iconFile)) {
        log.error("图标文件不存在:", iconFile);
      } else {
        log.info("图标文件存在:", iconFile);
      }

      if (!fs.existsSync(circleHtmlFile)) {
        log.error("圆形控件HTML文件不存在:", circleHtmlFile);
      } else {
        log.info("圆形控件HTML文件存在:", circleHtmlFile);
      }

      // 数据库初始化
      log.info("开始初始化数据库...");
      try {
        if (!app.isPackaged) {
          // 开发环境
          log.info("开发环境 - 使用本地数据库");
          DB = getDB();

          log.info("数据库连接已初始化，开始迁移操作");
          await migrateRun();
        } else {
          // 生产环境
          log.info("生产环境 - 使用用户数据目录", userDataPath);
          DB = getDB(userDataPath);

          log.info("数据库连接已初始化，开始迁移操作");
          await migrateRun(userDataPath);
        }
        log.info("数据库连接:", DB);

        // 在这里初始化 fileWriter — 传入默认笔记目录
        fileWriter = new FileWriter(DB, defaultNotesDir);
        // 等待 fileWriter 初始化完成（含旧值迁移）
        await fileWriter.initPath();

        // 初始化设置存储（依赖数据库）
        initSettingsStore(DB);
        configManager.initialize(DB);

        // 初始化本地记忆索引
        log.info("初始化本地记忆索引...");
        try {
          vectorStore.init(DB);
          await vectorStore.initialize();
          log.info("本地记忆索引初始化成功");
        } catch (vectorErr) {
          log.error("本地记忆索引初始化失败", vectorErr);
          // 不阻止应用启动，但记录错误
        }

      } catch (dbErr) {
        log.error("数据库操作失败", dbErr);
      }

      // 初始化配置管理
      log.info("初始化配置管理...");
      const baiduKeys = await configManager.getBaiduKeys();

      // 设置百度OCR密钥
      if (baiduKeys.apiKey && baiduKeys.secretKey) {
        setBaiduKeys(baiduKeys.apiKey, baiduKeys.secretKey);
        log.info("百度OCR密钥已设置");
      }

      // 先注册 IPC，再创建窗口
      //
      // createMainWindow() 内部会立即 loadURL，渲染层加载完就会发起一批
      // IPC 调用。若 handler 尚未注册，渲染层拿到的全是
      // "No handler registered for 'xxx'" —— 而且这种错误只在启动瞬间出现，
      // 表现为剪贴板列表 / 会话 / 技能等数据集体加载失败，极难定位。
      // 注册不依赖窗口句柄的部分不依赖 win 参数，放前面没有副作用。
      log.info("注册IPC处理程序...");
      registerIpcHandlers();
      log.info("IPC处理程序已注册");

      // 创建主窗口
      createMainWindow();

      // 窗口就绪后再注册依赖 win 的 handler
      registerWindowScopedHandlers();

      // 处理「双击图标启动且命令行里带着 --add-shortcut」的首次启动场景。
      // 放在 createMainWindow 之后：dispatch 内部要靠 did-finish-load 兜住
      // 渲染层尚未挂载的时序，放早了窗口还不存在。
      dispatchAddShortcutArg(process.argv);

      // 注册笔记预览协议。特权声明（registerSchemesAsPrivileged）已在
      // notesProtocol 模块顶层完成 —— 那必须在 app ready 之前，挪到这里会抛异常。
      // 这里只注册 handler，getRoot 现取 fileWriter，切换目录后立即生效。
      registerNotesProtocol(async () => {
        try {
          return fileWriter ? await fileWriter.getFilePath() : null;
        } catch {
          return null;
        }
      });

      // 创建托盘
      tray = createTray();

      // 创建圆形控件窗口
      createCircleWindow();

      // 注册全局快捷键
      const { getCircleWindow } = require("./core/window/circleWidget");
      globalShortcut.register("CommandOrControl+Enter", () => {
        // 窗口可能停在两种后台态：最小化（图标留在任务栏）和隐藏到托盘。
        // 原来只调 show()，对最小化态不可靠，快捷键会"按了没反应"。
        showMainWindow();
        getCircleWindow()?.hide();
      });

      // 注册快捷键小窗
      const clipboardPopup = ClipboardPopupWindow.getInstance();

      // 保留 registerGlobalShortcuts 第二个参数以避免改 shortcuts.ts 接口
      registerGlobalShortcuts(
        () => {
          if (clipboardPopup.isVisible()) {
            clipboardPopup.hide();
          } else {
            clipboardPopup.show();
          }
        },
        () => {
          /* no-op：AI 弹窗已移除，Ctrl+Shift+A 不再做任何事 */
        }
      );

      // 注册语音输入快捷键（收起为宠物时用）。
      // 放在 registerGlobalShortcuts 之后：若两者撞键，后注册的会失败并打出
      // 明确的 warn 日志，而不是静默覆盖掉剪贴板小窗的 Ctrl+Shift+V。
      void (async () => {
        try {
          const accelerator = await configManager.getVoiceHotkey();
          registerVoiceShortcut(accelerator, triggerVoiceInput);
        } catch (err) {
          log.error("[voice] 注册语音快捷键失败", err);
        }
      })();

      // 启动剪贴板监听
      const mainWin = getMainWindow();
      if (mainWin) {
        clipboardListener(mainWin, DB);
      }

      log.info("应用程序启动完成");
    } catch (err) {
      const startupError = err instanceof Error ? err : new Error(String(err));
      log.error("应用程序启动失败", startupError);

      // 尝试显示错误对话框
      try {
        const errorWin = new BrowserWindow({
          width: 600,
          height: 400,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
          }
        });

        errorWin.loadURL(`data:text/html,
          <html>
            <head><title>启动错误</title></head>
            <body>
              <h2>应用程序启动失败</h2>
              <pre>${startupError.toString()}\n${startupError.stack || ''}</pre>
            </body>
          </html>
        `);
      } catch (e) {
        log.error("显示错误窗口失败", e);
      }
    }
  });
