import {
  app,
  BrowserWindow,
  Tray,
  globalShortcut,
  ipcMain,
  shell,
} from "electron";
import * as path from "node:path";
import { migrateRun } from "../database/migrations/index";
import { clipboardListener, stopClipboardListener } from "./core/clipboard/clipboardListener";
import { FileWriter } from "./core/notes/fileWriter";
import { floatingPanelStore } from "./core/ai/floatingPanel";
import { getDB, closeDB } from "../database/index";
import { log, installStdoutGuard } from "./core/system/log";
import { parseExternalUrl } from "./utils/externalUrl";
import * as fs from "node:fs";
import { setBaiduKeys } from "./core/ai/baiduOCR";
import {
  configManager,
  DEFAULT_VOICE_HOTKEY,
  DEFAULT_CLIPBOARD_PANEL_HOTKEY,
} from "./core/system/config";
import { vectorStore } from "./core/ai/vectorStore";
import { initSettingsStore } from "./core/system/settingsStore";
import { registerFileHandlers } from "./handlers/notes/fileHandlers";
import { ExternalFolderStore } from "./core/notes/externalFolderStore";
import { registerNoteHandlers } from "./handlers/notes/noteHandlers";
import { registerTemplateHandlers } from "./handlers/ai/templateHandlers";
import { registerOcrHandlers } from "./handlers/ai/ocrHandlers";
import { registerConfigHandlers } from "./handlers/system/configHandlers";
import { registerAiHandlers } from "./handlers/ai/aiHandlers";
import { registerVectorHandlers } from "./handlers/ai/vectorHandlers";
import { registerMcpHandlers } from "./handlers/ai/mcpHandlers";
import { mcpManager } from "./core/ai/mcp/manager";
import { registerLeetcodeHandlers } from "./handlers/leetcode/leetcodeHandlers";
import { registerDatabaseTransferHandlers } from "./handlers/system/databaseTransferHandlers";
import { registerClipboardPopupHandlers } from "./handlers/clipboard/clipboardPopupHandlers";
import { registerStickyNoteHandlers } from "./handlers/sticky/stickyNoteHandlers";
import { registerIslandHandlers, disposeIsland } from "./handlers/island/islandHandlers";
import { stickyNoteManager } from "./core/window/sticky/stickyNote";
import { registerNotesProtocol } from "./handlers/notes/notesProtocol";
import { registerTodoHandlers } from "./handlers/todo/todoHandlers";
import { registerBrowserHandlers, teardownBrowserHandlers } from "./handlers/browser/browserHandlers";
import { registerBookmarkHandlers } from "./handlers/browser/bookmarkHandlers";
import { registerShortcutHandlers } from "./handlers/shortcut/shortcutHandlers";
import { registerUpdateHandlers } from "./handlers/update/updateHandlers";
import { initUpdater } from "./core/update/updater";
import { parseAddShortcutArg, repairContextMenu } from "./utils/shellContextMenu";
import { registerAsrHandlers } from "./handlers/ai/asrHandlers";
import { registerAppHandlers, teardownAppHandlers, resolveAppProjectDir } from "./handlers/apps/appHandlers";
import { registerCloudHandlers } from "./handlers/cloud/cloudHandlers";
import { initCloudStorage } from "../database/cloud/cloudManager";
import {
  registerAppPreviewScheme,
  initAppPreviewProtocol,
  attachAppPreview,
  disposeAppPreview,
} from "./core/window/apps/appPreview";
import { createMainWindow, getMainWindow, showMainWindow, createTray } from "./core/window/index";
import { ClipboardPopupWindow } from "./core/window/clipboard/clipboardPopup";
import { IslandWindow } from "./core/window/island/island";
import {
  unregisterAllShortcuts,
  registerVoiceShortcut,
  validateAccelerator,
  getRegisteredVoiceAccelerator,
  registerClipboardPanelShortcut,
  getRegisteredPanelAccelerator,
} from "./core/shortcut/shortcuts";
import { markQuitting } from "./core/system/appState";
import { getAssetsDir, resolveAppIcon } from "./utils/assets";

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    dispatchAddShortcutArg(argv);
  });
}

function dispatchAddShortcutArg(argv: string[]): void {
  const target = parseAddShortcutArg(argv);
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

installStdoutGuard();

process.env.NODE_ENV = process.env.NODE_ENV || "development";

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

if (!app.isPackaged || process.env.QNOTE_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.QNOTE_REMOTE_DEBUG_PORT || "9222"
  );
} else {
  console.warn(
    "[qnote] 打包环境已禁用 CDP 远程调试端口（如需调试打包版请设 QNOTE_REMOTE_DEBUG_PORT=9222）"
  );
}

app.commandLine.appendSwitch("disable-features", "Autofill");

registerAppPreviewScheme();

const existingFeatures = app.commandLine.getSwitchValue("enable-features");
app.commandLine.appendSwitch(
  "enable-features",
  existingFeatures ? `${existingFeatures},OverlayScrollbar` : "OverlayScrollbar"
);

let tray: Tray | null = null;
let DB: any;
let fileWriter: FileWriter;
let externalFolderStore: ExternalFolderStore;

function toggleClipboardPanel(): void {
  const clipboardPopup = ClipboardPopupWindow.getInstance();
  if (clipboardPopup.isVisible()) {
    clipboardPopup.hide();
    return;
  }
  void clipboardPopup.show().catch((err) => {
    log.error("[clipboardPopup] 显示剪贴板面板失败", err);
  });
}

function triggerVoiceInput(): void {
  const mainWin = getMainWindow();
  if (!mainWin || mainWin.isDestroyed()) {
    log.warn("[voice] 主窗口不存在，忽略快捷键");
    return;
  }
  const wasHidden = !mainWin.isVisible() || mainWin.isMinimized();
  if (wasHidden) {
    showMainWindow();
  }
  log.info("[voice] 快捷键触发", {
    accelerator: getRegisteredVoiceAccelerator(),
    restoredWindow: wasHidden,
  });
  mainWin.webContents.send("voice-hotkey:triggered");
}

function registerIpcHandlers() {
  registerFileHandlers(fileWriter, externalFolderStore);
  registerNoteHandlers(DB);
  registerTemplateHandlers(DB);
  registerMcpHandlers();
  registerOcrHandlers(DB);
  registerConfigHandlers();
  registerAiHandlers(DB, fileWriter);
  registerVectorHandlers(DB);
  registerLeetcodeHandlers(DB);
  registerClipboardPopupHandlers();
  registerStickyNoteHandlers();
  registerIslandHandlers(fileWriter);
  registerTodoHandlers(DB);
  registerBookmarkHandlers(DB);
  registerShortcutHandlers(DB);
  registerAsrHandlers();
  registerUpdateHandlers();
  registerAppHandlers(DB);
  registerCloudHandlers();
}

function registerWindowScopedHandlers() {
  const win = getMainWindow();
  registerDatabaseTransferHandlers(DB, win);
  registerBrowserHandlers(win);

  attachAppPreview(win);
  initAppPreviewProtocol(resolveAppProjectDir);

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
    const result = registerVoiceShortcut(accelerator, triggerVoiceInput);
    if (!result.ok) {
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

  ipcMain.handle("clipboard-panel:get-hotkey", async () => {
    try {
      const registered = getRegisteredPanelAccelerator();
      const configured = await configManager.getClipboardPanelHotkey();
      return {
        ok: true,
        accelerator: registered ?? configured,
        active: registered !== null,
      };
    } catch (err) {
      log.error("[clipboardPanel] 读取面板快捷键失败", err);
      return { ok: false, error: "读取面板快捷键失败" };
    }
  });

  ipcMain.handle("clipboard-panel:set-hotkey", async (_event, accelerator: string) => {
    const check = validateAccelerator(accelerator);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    try {
      await configManager.setClipboardPanelHotkey(accelerator);
    } catch (err) {
      log.error("[clipboardPanel] 保存面板快捷键失败", err);
      return { ok: false, error: "保存失败" };
    }
    const result = registerClipboardPanelShortcut(accelerator, toggleClipboardPanel);
    if (!result.ok) {
      await configManager.setClipboardPanelHotkey(DEFAULT_CLIPBOARD_PANEL_HOTKEY);
      const fallback = registerClipboardPanelShortcut(
        DEFAULT_CLIPBOARD_PANEL_HOTKEY,
        toggleClipboardPanel
      );
      if (fallback.ok) {
        return {
          ok: false,
          error: `${result.error}。已恢复为默认快捷键 ${DEFAULT_CLIPBOARD_PANEL_HOTKEY}`,
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
    try {
      const parsed = parseExternalUrl(url);
      if (!parsed) {
        log.warn("open-external blocked unsafe URL:", { url });
        return false;
      }
      await shell.openExternal(parsed.toString()); // NOSONAR
      return true;
    } catch (err) {
      log.error("打开外部链接失败", { url, err });
      return false;
    }
  });
}

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
  markQuitting();
});

app.on("will-quit", () => {
  unregisterAllShortcuts();
  stopClipboardListener();
  closeDB();

  const clipboardPopup = ClipboardPopupWindow.getInstance();
  clipboardPopup.destroy();

  stickyNoteManager.destroyAll();

  disposeIsland();

  teardownBrowserHandlers();

  teardownAppHandlers();
  disposeAppPreview();

  tray?.destroy();
  tray = null;
});

app.on("window-all-closed", () => {
  app.quit();
});

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch
  );
}

void app
  .whenReady()
  .then(async () => {
    if (!hasSingleInstanceLock) return;

    if (process.platform === "win32") {
      app.setAppUserModelId("com.ruciazyt.qnote");
    }

    log.initialize();
    log.info('应用程序启动中...');

    try {
      const userDataPath = app.getPath('userData');
      log.info("userData路径:", userDataPath);

      const defaultNotesDir = path.join(userDataPath, "notes");
      if (!fs.existsSync(defaultNotesDir)) {
        try {
          fs.mkdirSync(defaultNotesDir, { recursive: true });
          log.info("默认笔记目录已创建:", defaultNotesDir);
        } catch (mkdirErr) {
          log.error("创建默认笔记目录失败:", mkdirErr);
        }
      }

      const assetPath = getAssetsDir();
      log.info("资源文件路径:", assetPath);

      const iconFile = resolveAppIcon() ?? path.join(assetPath, "icon.ico");

      if (!fs.existsSync(iconFile)) {
        log.error("图标文件不存在:", iconFile);
      } else {
        log.info("图标文件存在:", iconFile);
      }

      log.info("开始初始化数据库...");
      try {
        if (!app.isPackaged) {
          log.info("开发环境 - 使用本地数据库");
          DB = getDB();

          log.info("数据库连接已初始化，开始迁移操作");
          await migrateRun();
        } else {
          log.info("生产环境 - 使用用户数据目录", userDataPath);
          DB = getDB(userDataPath);

          log.info("数据库连接已初始化，开始迁移操作");
          await migrateRun(userDataPath);
        }
        log.info("数据库连接:", DB);

        fileWriter = new FileWriter(DB, defaultNotesDir);
        await fileWriter.initPath();

        externalFolderStore = new ExternalFolderStore(DB);

        initSettingsStore(DB);
        configManager.initialize(DB);

        initCloudStorage(DB);

        try {
          await mcpManager.init(DB);
        } catch (mcpErr) {
          log.error("[mcp] 初始化失败", mcpErr);
        }

        try {
          const islandSettings = await configManager.getIslandSettings();
          const island = IslandWindow.getInstance();
          island.setEnabled(islandSettings.enabled);
          island.applyDock(
            islandSettings.attachMode,
            islandSettings.dockEdge,
            islandSettings.position,
            islandSettings.displayId
          );
          log.info("[island] 灵动岛配置已加载", {
            enabled: islandSettings.enabled,
            expandTrigger: islandSettings.expandTrigger,
            attachMode: islandSettings.attachMode,
          });
        } catch (err) {
          log.error("[island] 加载灵动岛配置失败", err);
        }

        log.info("初始化本地记忆索引...");
        try {
          vectorStore.init(DB);
          await vectorStore.initialize();
          log.info("本地记忆索引初始化成功");
        } catch (vectorErr) {
          log.error("本地记忆索引初始化失败", vectorErr);
        }

      } catch (dbErr) {
        log.error("数据库操作失败", dbErr);
      }

      log.info("初始化配置管理...");
      const baiduKeys = await configManager.getBaiduKeys();

      if (baiduKeys.apiKey && baiduKeys.secretKey) {
        setBaiduKeys(baiduKeys.apiKey, baiduKeys.secretKey);
        log.info("百度OCR密钥已设置");
      }

      log.info("注册IPC处理程序...");
      registerIpcHandlers();
      log.info("IPC处理程序已注册");

      initUpdater();

      createMainWindow();

      try {
        stickyNoteManager.restoreAll();
      } catch (err) {
        log.error("[sticky] 恢复便签失败:", err);
      }

      registerWindowScopedHandlers();

      if (app.isPackaged) {
        void (async () => {
          try {
            const result = await repairContextMenu();
            if (result.repaired) {
              log.info("[shell-menu] 已修复失效的右键菜单命令");
            }
          } catch (err) {
            log.warn("[shell-menu] 右键菜单自愈失败:", err);
          }
        })();
      }

      dispatchAddShortcutArg(process.argv);

      registerNotesProtocol(
        async () => {
          try {
            return fileWriter ? await fileWriter.getFilePath() : null;
          } catch {
            return null;
          }
        },
        async (id: string) => {
          try {
            if (!externalFolderStore) return null;
            const folder = await externalFolderStore.get(id);
            return folder?.path ?? null;
          } catch {
            return null;
          }
        }
      );

      tray = createTray();

      globalShortcut.register("CommandOrControl+Enter", () => {
        showMainWindow();
      });

      void (async () => {
        try {
          const accelerator = await configManager.getClipboardPanelHotkey();
          const result = registerClipboardPanelShortcut(accelerator, toggleClipboardPanel);
          if (!result.ok) {
            log.warn(`[clipboardPanel] 面板快捷键未生效：${result.error}`);
          }
        } catch (err) {
          log.error("[clipboardPanel] 注册面板快捷键失败", err);
        }
      })();

      void (async () => {
        try {
          const accelerator = await configManager.getVoiceHotkey();
          registerVoiceShortcut(accelerator, triggerVoiceInput);
        } catch (err) {
          log.error("[voice] 注册语音快捷键失败", err);
        }
      })();

      const mainWin = getMainWindow();
      if (mainWin) {
        clipboardListener(mainWin, DB);
      }

      log.info("应用程序启动完成");
    } catch (err) {
      const startupError = err instanceof Error ? err : new Error(String(err));
      log.error("应用程序启动失败", startupError);

      try {
        const errorWin = new BrowserWindow({
          width: 600,
          height: 400,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        const detail = escapeHtml(
          `${startupError.toString()}\n${startupError.stack || ""}`
        );
        const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>启动错误</title></head>
  <body>
    <h2>应用程序启动失败</h2>
    <pre>${detail}</pre>
  </body>
</html>`;
        void errorWin.loadURL(
          "data:text/html;charset=utf-8," + encodeURIComponent(html)
        );
      } catch (e) {
        log.error("显示错误窗口失败", e);
      }
    }
  });
