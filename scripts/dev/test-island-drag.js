/**
 * 灵动岛拖拽探针（临时）
 *
 * jsdom 里跑不出真实浏览器的手感 —— 指针捕获、screenX、事件冒泡
 * 在真 Chromium 里才作数。所以另起一个最小 Electron 应用：
 * 加载岛的真实产物，用 sendInputEvent 模拟一次拖拽，
 * 打印渲染层到底发了哪些 IPC。
 *
 * 用法：electron scripts/dev/test-island-drag.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 渲染层发来的拖拽动作 */
const dragCalls = [];

function registerMocks() {
  ipcMain.handle("island:get-settings", () => ({
    enabled: true,
    expandTrigger: "click",
    hoverDelayMs: 300,
    attachMode: "attached",
    position: null,
    displayId: null,
  }));
  ipcMain.handle("island:get-state", () => ({
    expanded: false,
    page: "todo",
    attachMode: "attached",
    size: { width: 330, height: 44 },
    position: { x: 0, y: 0 },
  }));
  ipcMain.handle("island:get-recent-notes", () => []);
  ipcMain.handle("island:get-ai-activity", () => ({
    running: false,
    title: "",
    sessionId: null,
    startedAt: null,
    tool: null,
  }));
  ipcMain.handle("todo:list", () => []);
  ipcMain.handle("popup-get-clipboard-history", () => []);
  ipcMain.on("island:set-collapsed-width", () => {});
  ipcMain.on("island:set-page", () => {});
  ipcMain.on("island:expand", () => {});
  ipcMain.on("island:collapse", () => {});
  ipcMain.on("island:toggle", () => {});
  ipcMain.on("island:drag-start", (_e, p) => dragCalls.push(["start", p]));
  ipcMain.on("island:drag-move", (_e, p) => dragCalls.push(["move", p]));
  ipcMain.on("island:drag-end", () => dragCalls.push(["end", null]));
}

app.whenReady().then(async () => {
  registerMocks();

  const htmlPath = path.join(repoRoot, "dist", "renderer", "island.html");

  const win = new BrowserWindow({
    width: 330,
    height: 44,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(repoRoot, "dist", "main", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(htmlPath);
  await wait(1200);

  // 渲染层的报错 —— 拖拽没反应时，多半是这里抛了异常
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log(`[console:${level}] ${message} (${source}:${line})`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.log("[render-process-gone]", JSON.stringify(details));
  });

  // 胶囊摘要区的大致位置（避开四个模块按钮与右侧箭头）
  const probe = await win.webContents.executeJavaScript(`
    (() => {
      const pill = document.querySelector('.island-pill');
      if (!pill) return 'no-pill';
      const r = pill.getBoundingClientRect();
      const s = document.querySelector('.island-pill-summary');
      const sr = s ? s.getBoundingClientRect() : null;
      return JSON.stringify({
        pill: { x: r.x, y: r.y, w: r.width, h: r.height },
        summary: sr ? { x: sr.x, y: sr.y, w: sr.width, h: sr.height } : null,
      });
    })()
  `);
  console.log("[probe]", probe);
  const box = JSON.parse(probe);
  const sx = Math.round(box.summary.x + box.summary.w / 2);
  const sy = Math.round(box.summary.y + box.summary.h / 2);

  const before = win.getBounds();
  console.log("[before]", before);

  // 模拟一次拖拽：按下 → 移动 120px → 移动 240px → 松手
  const trace = await win.webContents.executeJavaScript(`
    (() => {
      window.__trace = [];
      const root = document.querySelector('.island-root');
      const pill = document.querySelector('.island-pill');
      root.addEventListener('pointerdown', (e) => window.__trace.push(['root pointerdown', e.button, e.screenX, e.screenY]), true);
      root.addEventListener('pointermove', (e) => window.__trace.push(['root pointermove', e.screenX, e.screenY]), true);
      root.addEventListener('pointerup', (e) => window.__trace.push(['root pointerup', e.screenX, e.screenY]), true);
      pill.addEventListener('pointerdown', (e) => window.__trace.push(['pill pointerdown', e.button, e.screenX, e.screenY]), true);
      return 'ok';
    })()
  `);
  console.log("[trace-setup]", trace);

  win.webContents.sendInputEvent({ type: "mouseMove", x: sx, y: sy });
  await wait(60);
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: sx,
    y: sy,
    button: "left",
    clickCount: 1,
  });
  await wait(60);
  win.webContents.sendInputEvent({ type: "mouseMove", x: sx + 40, y: sy + 30 });
  await wait(60);
  win.webContents.sendInputEvent({ type: "mouseMove", x: sx + 120, y: sy + 90 });
  await wait(120);
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: sx + 120,
    y: sy + 90,
    button: "left",
    clickCount: 1,
  });
  await wait(200);

  console.log("[drag calls]", JSON.stringify(dragCalls));
  console.log("[after]", win.getBounds());

  const traceDump = await win.webContents.executeJavaScript(
    `JSON.stringify(window.__trace || [])`
  );
  console.log("[trace]", traceDump);

  win.destroy();
  app.quit();
});
