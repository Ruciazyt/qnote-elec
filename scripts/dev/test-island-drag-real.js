const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

const WIN_X = 300;
const WIN_Y = 200;
const WIN_W = 330;
const WIN_H = 44;

const TARGET_X = WIN_X + 208;
const TARGET_Y = WIN_Y + 22;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
    size: { width: WIN_W, height: WIN_H },
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
  ipcMain.on("island:drag-start", (_e, p) => {
    dragCalls.push(["start", p]);
    console.log("[ipc] drag-start", JSON.stringify(p));
  });
  ipcMain.on("island:drag-move", (_e, p) => {
    dragCalls.push(["move", p]);
    console.log("[ipc] drag-move", JSON.stringify(p));
  });
  ipcMain.on("island:drag-end", () => {
    dragCalls.push(["end", null]);
    console.log("[ipc] drag-end");
  });
}

app.whenReady().then(async () => {
  registerMocks();

  const win = new BrowserWindow({
    x: WIN_X,
    y: WIN_Y,
    width: WIN_W,
    height: WIN_H,
    show: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(repoRoot, "dist", "main", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(path.join(repoRoot, "dist", "renderer", "island.html"));
  await wait(1500);

  await win.webContents.executeJavaScript(`
    (() => {
      window.__trace = [];
      const push = (tag, e) => window.__trace.push([tag, e.button, e.screenX, e.screenY]);
      document.addEventListener('pointerdown', (e) => push('down', e), true);
      document.addEventListener('pointermove', (e) => push('move', e), true);
      document.addEventListener('pointerup', (e) => push('up', e), true);
    })()
  `);

  console.log(`[ready] target=(${TARGET_X},${TARGET_Y}) bounds=${JSON.stringify(win.getBounds())}`);

  for (let i = 0; i < 40; i += 1) {
    await wait(1000);
    if (dragCalls.length > 0 && dragCalls[dragCalls.length - 1][0] === "end") break;
  }

  const trace = await win.webContents.executeJavaScript(
    `JSON.stringify(window.__trace || [])`
  );
  console.log("[trace]", trace);
  console.log("[drag calls]", JSON.stringify(dragCalls));
  console.log("[final bounds]", JSON.stringify(win.getBounds()));

  win.destroy();
  app.quit();
});
