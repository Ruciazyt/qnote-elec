import { BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { app } from "electron";
import { log } from "../../utils/log";
import { markQuitting, shouldHideToTray } from "../../utils/appState";
import { resolveAppIcon } from "../../utils/assets";

let win: BrowserWindow | null = null;
// 存储IPC监听器引用，用于清理
const ipcListenerRefs: Array<{ channel: string; handler: (...args: any[]) => void }> = [];

function getPreloadPath() {
  return path.join(__dirname, "..", "..", "preload.js");
}

function shouldAutoOpenDevTools() {
  return process.env.QNOTE_OPEN_DEVTOOLS === "true";
}

export function getMainWindow(): BrowserWindow | null {
  return win;
}

/**
 * 把主窗口从任意后台状态唤回前台。
 *
 * Electron 的窗口有三种"看不见"的状态，各自有不同的唤回姿势，只调 show()
 * 覆盖不全：
 *   - 最小化      → show() 不可靠，必须先 restore()
 *   - 隐藏到托盘  → show() 能显示，但 setSkipTaskbar(true) 摘掉的图标要补回来
 *   - 被遮挡      → show() 正常
 * 所以这里统一兜住两种后台态，托盘点击、全局快捷键都走这个入口。
 */
export function showMainWindow(): void {
  if (!win || win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }
  win.setSkipTaskbar(false);
  win.show();
}

// 清理所有注册的IPC监听器
export function cleanupMainWindowListeners(): void {
  for (const { channel, handler } of ipcListenerRefs) {
    ipcMain.removeListener(channel, handler);
  }
  ipcListenerRefs.length = 0;
  log.info("主窗口IPC监听器已清理");
}

export function createMainWindow(): BrowserWindow {
  log.info("开始创建主窗口...");

  const iconPath = resolveAppIcon();
  if (iconPath) {
    log.info("主窗口图标路径:", iconPath);
  } else {
    log.warn("未找到主窗口图标文件");
  }

  win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 1000,
    minHeight: 700,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: true,
      // PDF 笔记靠 Chromium 内置阅读器渲染，不开这个 <embed src="file://…pdf">
      // 会静默变成空白框，且不报错 —— 排查起来很费时间。
      plugins: true,
    },
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    icon: iconPath || undefined,
    show: false, // 先不显示，等加载完成后再显示
  });

  log.info("主窗口已创建");

  /**
   * 权限白名单
   *
   * 没有这个处理器时，渲染层调 getUserMedia 会被 Electron 默认**拒绝**，
   * 而且不是抛错 —— 只是 ontrack 永远不触发、AudioContext 保持 suspended，
   * 界面上表现为「点了录音没反应」，排查时完全看不出是权限被挡了。
   *
   * 注意一个容易踩的坑：**注册了处理器就等于接管了默认值，默认值是拒绝**。
   * 所以不能写成「非 media 一律 callback(false)」然后注释说保持默认 ——
   * 那样会把剪贴板一起挡掉，navigator.clipboard.writeText 直接抛
   * NotAllowedError: Write permission denied，界面上只表现为「复制失败」。
   * 这里改成显式白名单：麦克风 + 剪贴板读写放行，其余一律拒绝。
   *
   * 两个处理器都在默认 session 上注册，因此对所有使用默认 session 的窗口生效。
   */
  const ALLOWED_PERMISSIONS = new Set([
    "media",                   // 麦克风：语音输入
    "clipboard-read",          // 读剪贴板
    "clipboard-write",         // 写剪贴板：笔记复制、设置页路径复制
    "clipboard-sanitized-write",
  ]);

  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === "media") {
      const mediaTypes = (details as any)?.mediaTypes as string[] | undefined;
      // mediaTypes 为 undefined 表示旧版调用方式；只要不含 video 就放行
      const wantsVideoOnly = Array.isArray(mediaTypes) && mediaTypes.length > 0 &&
        !mediaTypes.includes("audio");
      callback(!wantsVideoOnly);
      return;
    }
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  // 已授予过的麦克风权限不再重复弹窗询问
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });

  // 检查preload.js是否存在
  const preloadPath = getPreloadPath();
  if (!fs.existsSync(preloadPath)) {
    log.error("preload.js不存在:", preloadPath);
  } else {
    log.info("preload.js存在:", preloadPath);
  }

  // 根据环境加载不同的URL
  const loadUrl = app.isPackaged
    ? `file://${path.join(process.resourcesPath, "renderer/dist", "index.html")}`
    : "http://localhost:5173";

  log.info("准备加载URL:", loadUrl);

  // 监听ready-to-show事件，窗口准备好后再显示
  win.once('ready-to-show', () => {
    log.info("窗口准备就绪，显示窗口");
    win?.show();
  });

  // 监听加载失败事件
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error(`加载失败: ${errorCode} - ${errorDescription}`, { url: loadUrl });

    // 尝试显示错误信息
    //
    // 错误提示页同样可能加载失败（窗口已被销毁等），接住 reject 并记日志，
    // 免得变成"未处理的Promise拒绝"。
    //
    // **必须 encodeURIComponent**：data: URL 里不能有裸换行和未转义的尖括号。
    // 之前这里直接用多行模板字符串拼 data:text/html，含换行 → URL 非法 →
    // loadURL 抛错 → 出错时反而什么都看不到，只剩一行 ERR_FAILED。
    const errorHtml = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>加载错误</title></head>',
      '<body>',
      '<h2>无法加载应用界面</h2>',
      `<p>错误代码: ${errorCode}</p>`,
      `<p>错误描述: ${errorDescription}</p>`,
      `<p>加载URL: ${loadUrl}</p>`,
      '</body></html>',
    ].join('');
    void win?.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`)
      .catch((error) => {
        log.error("加载错误提示页失败:", error);
      });
  });

  // 监听加载成功事件
  win.webContents.on('did-finish-load', () => {
    log.info("页面加载完成");
    win?.webContents.send("window-maximized", win?.isMaximized() ?? false);
  });

  // loadURL 失败会 reject（渲染进程没起来、URL 不对等），接住并记日志，
  // 免得变成"未处理的Promise拒绝"。
  win.loadURL(loadUrl).catch((error) => {
    log.error("加载主窗口页面失败:", error);
  });

  // 默认不自动打开 DevTools，避免 Chromium DevTools 内部日志干扰开发输出。
  if (!app.isPackaged && shouldAutoOpenDevTools()) {
    log.info("开发环境，按环境变量配置自动打开开发者工具");
    win.webContents.openDevTools();
  }

  // 隐藏默认菜单
  win.setMenu(null);

  win.on("close", (event: any) => {
    // 关键判断用**全局**退出状态，不能用本模块的局部标志位。
    //
    // 局部标志位只在标题栏 X 按钮（closeWindowHandler）里被置上；
    // 托盘菜单的「退出」直接调 app.quit()，不经过这里。于是走托盘退出时
    // 本模块的标志位仍是 false → 窗口被藏进托盘 + preventDefault() →
    // **整个退出流程被取消**，而 before-quit 那边已经把数据库连接池销毁了。
    // 应用活着、数据库死了，之后所有写库操作都抛
    // "Unable to acquire a connection"（清空记录、添加快捷方式就是这么坏的）。
    //
    // shouldHideToTray() 由全局退出状态推导，覆盖所有退出入口。
    if (shouldHideToTray() && win) {
      // 关闭按钮 = 隐藏到托盘，与最小化是两回事（产品确认过）：
      // 最小化走原生 minimize、图标留在任务栏；关闭才是真的收进托盘，
      // 唤回入口是托盘图标 / 右键菜单「显示应用」/ 全局快捷键。
      win.hide();
      win.setSkipTaskbar(true);
      event.preventDefault();
    }
  });

  // 窗口关闭时清理监听器
  win.on("closed", () => {
    cleanupMainWindowListeners();
    win = null;
  });

  // 通知渲染进程窗口最大化状态变化
  const maximizeHandler = () => {
    win?.webContents.send("window-maximized", true);
  };
  const unmaximizeHandler = () => {
    win?.webContents.send("window-maximized", false);
  };
  const minimizeStateHandler = () => {
    // 最小化保留任务栏图标，不要摘。
    //
    // 之前这里是 setSkipTaskbar(true)：Windows 点已激活窗口的任务栏图标本来
    // 就会触发最小化，这行直接把图标整个摘掉，用户看到的是"点了应用反而消失"，
    // 之后只能去托盘找。图标留着，点它由系统原生恢复。
    win?.setSkipTaskbar(false);
  };
  const restoreStateHandler = () => {
    win?.setSkipTaskbar(false);
    win?.webContents.send("window-maximized", win?.isMaximized() ?? false);
  };
  win.on("maximize", maximizeHandler);
  win.on("unmaximize", unmaximizeHandler);
  win.on("minimize", minimizeStateHandler);
  win.on("restore", restoreStateHandler);
  ipcListenerRefs.push({ channel: "maximize", handler: maximizeHandler as any });
  ipcListenerRefs.push({ channel: "unmaximize", handler: unmaximizeHandler as any });
  ipcListenerRefs.push({ channel: "minimize", handler: minimizeStateHandler as any });
  ipcListenerRefs.push({ channel: "restore", handler: restoreStateHandler as any });

  // 注册窗口控制IPC事件
  const minimizeHandler = () => {
    if (!win) {
      return;
    }

    // 用系统原生 minimize，而不是 hide() + setSkipTaskbar(true)。
    //
    // hide() 是"窗口不存在了"：任务栏图标被摘掉、没有系统缩到任务栏的动画、
    // 点图标也唤不回来，只能找托盘。minimize() 是"窗口还在，只是缩到任务栏"：
    // 图标保留并显示「已最小化」下划线，点它由系统直接恢复。
    win.setSkipTaskbar(false);
    win.minimize();
  };
  const maximizeWindowHandler = () => {
    if (!win) {
      return;
    }

    if (win.isMaximized()) {
      win.unmaximize();
    } else if (win.isMaximizable()) {
      win.maximize();
    }
  };
  const closeWindowHandler = () => {
    // 先标记再退出：窗口的 close 处理器靠这个标志决定"收进托盘"还是"真的关"
    markQuitting();
    app.quit();
  };
  const openDevToolsHandler = () => {
    log.info("收到打开开发者工具请求");
    if (win) {
      log.info("窗口存在，打开开发者工具");
      win.webContents.openDevTools();
    } else {
      log.error("窗口不存在，无法打开开发者工具");
    }
  };

  ipcMain.on("minimize-window", minimizeHandler);
  ipcMain.on("maximize-window", maximizeWindowHandler);
  ipcMain.on("close-window", closeWindowHandler);
  ipcMain.on("open-dev-tools", openDevToolsHandler);

  ipcListenerRefs.push({ channel: "minimize-window", handler: minimizeHandler as any });
  ipcListenerRefs.push({ channel: "maximize-window", handler: maximizeWindowHandler as any });
  ipcListenerRefs.push({ channel: "close-window", handler: closeWindowHandler as any });
  ipcListenerRefs.push({ channel: "open-dev-tools", handler: openDevToolsHandler as any });

  log.info("主窗口事件注册完成");

  return win;
}
