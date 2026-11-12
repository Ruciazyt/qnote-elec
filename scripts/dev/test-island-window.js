/**
 * 灵动岛主进程窗口探针（临时）
 *
 * 渲染层那侧已经证明没问题（drag-start / drag-move / drag-end 都发出来了），
 * 这一版直接把**真的** IslandWindow 拉起来，看看 dragTo 到底有没有把窗口挪走。
 *
 * 用法：electron scripts/dev/test-island-window.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// IslandWindow 在开发模式下会去连 vite dev server —— 这里改成本地构建产物
const origLoadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = function (url) {
  const local = "file:///" + path.join(repoRoot, "dist", "renderer", "island.html").replace(/\\/g, "/");
  return origLoadURL.call(this, String(url).includes("5173") ? local : url);
};

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
}

app.whenReady().then(async () => {
  registerMocks();

  const { IslandWindow } = require(path.join(repoRoot, "dist", "main", "core", "window", "island.js"));
  const island = IslandWindow.getInstance();

  island.show();
  await wait(2000);

  console.log("[1] show 之后", JSON.stringify(island.getSnapshot()));

  // 模拟渲染层发来的三个动作
  island.beginDrag(508, 222);
  console.log("[2] beginDrag 之后", JSON.stringify(island.getSnapshot()));

  island.dragTo(648, 342);
  await wait(300);
  console.log("[3] dragTo 之后", JSON.stringify(island.getSnapshot()));

  const result = island.endDrag();
  await wait(300);
  console.log("[4] endDrag 结果", JSON.stringify(result));
  console.log("[5] endDrag 之后", JSON.stringify(island.getSnapshot()));

  app.quit();
});
