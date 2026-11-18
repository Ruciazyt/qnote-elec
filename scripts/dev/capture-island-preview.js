const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const repoRoot = path.resolve(__dirname, "..", "..");

const STRIP_WIDTH = 44;
const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 480;
const BAR_HEIGHT = 44;

const SAMPLE_TODOS = [
  {
    id: 1,
    title: "把灵动岛的收起态宽度定下来",
    notes: null,
    priority: "high",
    due_date: null,
    completed: 0,
    completed_at: null,
    archived_at: null,
    created_at: "2026-11-11T10:00:00",
    updated_at: "2026-11-11T10:00:00",
    attachments: [],
  },
  {
    id: 2,
    title: "跟参考实现对齐多屏跟随的判定",
    notes: null,
    priority: "medium",
    due_date: "2026-11-12",
    completed: 0,
    completed_at: null,
    archived_at: null,
    created_at: "2026-11-11T10:00:00",
    updated_at: "2026-11-11T10:00:00",
    attachments: [],
  },
  {
    id: 3,
    title: "写岛上的用例",
    notes: null,
    priority: "low",
    due_date: null,
    completed: 1,
    completed_at: "2026-11-11T11:00:00",
    archived_at: null,
    created_at: "2026-11-11T10:00:00",
    updated_at: "2026-11-11T10:00:00",
    attachments: [],
  },
];

const SAMPLE_CLIPBOARD = [
  { id: 11, type: "text", content: "const answer = 42;", time: new Date().toISOString() },
  { id: 12, type: "text", content: "https://github.com/flyl1u/fly-island", time: new Date().toISOString() },
  { id: 13, type: "text", content: "岛要贴顶，两侧顶端是直角", time: new Date().toISOString() },
];

const SAMPLE_NOTES = [
  { relPath: "设计/灵动岛.md", name: "灵动岛.md", mtime: Date.now(), type: "markdown" },
  { relPath: "设计/参考实现笔记.md", name: "参考实现笔记.md", mtime: Date.now() - 3600_000, type: "markdown" },
  { relPath: "草稿.excalidraw", name: "草稿.excalidraw", mtime: Date.now() - 7200_000, type: "excalidraw" },
];

const SAMPLE_AI_HISTORY = [
  { id: 1, role: "user", content: "帮我看看今天的待办怎么排优先级" },
  {
    id: 2,
    role: "assistant",
    content:
      "先把「把灵动岛的收起态宽度定下来」做完 —— 它卡着别的。\n" +
      "「多屏跟随」可以放到明天，它要动主进程的窗口逻辑。",
  },
  { id: 3, role: "user", content: "行，先做宽度" },
];

const SAMPLE_SESSIONS = [
  {
    id: "s-1",
    title: "整理周报",
    preview: "把本周的进展汇总一下",
    created_at: new Date("2026-11-11T10:00:00Z"),
    updated_at: new Date("2026-11-11T10:00:00Z"),
  },
  {
    id: "s-2",
    title: "查接口签名",
    preview: "HMAC 怎么算，密钥放哪",
    created_at: new Date("2026-11-10T14:20:00Z"),
    updated_at: new Date("2026-11-10T14:20:00Z"),
  },
  {
    id: "s-3",
    title: "灵动岛的收起态宽度",
    preview: "定成 330 还是 260",
    created_at: new Date("2026-11-09T09:05:00Z"),
    updated_at: new Date("2026-11-09T09:05:00Z"),
  },
];

function registerMocks() {
  ipcMain.handle("island:get-settings", () => ({
    enabled: true,
    expandTrigger: "click",
    hoverDelayMs: 300,
    attachMode: "attached",
    dockEdge: "top",
    position: null,
    displayId: null,
  }));
  ipcMain.handle("island:get-state", () => ({
    expanded: false,
    page: "todo",
    attachMode: "attached",
    dockEdge: "top",
    size: { width: PANEL_WIDTH, height: BAR_HEIGHT },
    position: { x: 0, y: 0 },
  }));
  ipcMain.handle("island:get-recent-notes", () => SAMPLE_NOTES);
  ipcMain.handle("island:get-ai-activity", () => ({
    running: false,
    title: "",
    sessionId: null,
    startedAt: null,
    tool: null,
  }));
  ipcMain.handle("todo:list", () => SAMPLE_TODOS);
  ipcMain.handle("todo:toggle", (_e, id) => ({
    ...SAMPLE_TODOS.find((t) => t.id === id),
    completed: 1,
  }));
  ipcMain.handle("popup-get-clipboard-history", () => SAMPLE_CLIPBOARD);
  ipcMain.handle("popup-copy-clipboard-item", () => ({ success: true }));
  ipcMain.handle("get-ai-chat-session-history", () => SAMPLE_AI_HISTORY);
  ipcMain.handle("get-ai-chat-sessions", () => SAMPLE_SESSIONS);
  ipcMain.handle("create-ai-chat-session", () => ({
    id: "s-new",
    title: "新建对话",
    preview: "",
    created_at: new Date(),
    updated_at: new Date(),
  }));
  ipcMain.handle("delete-ai-chat-session", () => true);
  ipcMain.handle("get-ai-skills", () => []);
  ipcMain.handle("send-ai-agent-stream", () => ({ sessionId: "preview-session" }));
  ipcMain.on("island:set-interactive", () => {});
  ipcMain.on("island:set-page", () => {});
  ipcMain.on("island:expand", () => {});
  ipcMain.on("island:collapse", () => {});
  ipcMain.on("island:toggle", () => {});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function dumpState(win, tag) {
  const state = await win.webContents.executeJavaScript(`
    (() => {
      const active = [...document.querySelectorAll('.island-tab')]
        .filter((el) => el.getAttribute('data-active') === 'true')
        .map((el) => el.textContent.trim());
      const body = document.querySelector('.island-panel-body');
      return JSON.stringify({
        activeTabs: active,
        bodyClass: body ? body.firstElementChild?.className ?? '(empty)' : '(no body)',
      });
    })()
  `);
  console.log(tag, state);
}

async function capture(win, file) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  console.log("wrote", file);
}

app.whenReady().then(async () => {
  registerMocks();

  const htmlPath = path.join(repoRoot, "dist", "renderer", "island.html");

  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: BAR_HEIGHT,
    show: false,
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
  await win.webContents.executeJavaScript(`
    (() => {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { transition: none !important; }';
      document.head.appendChild(style);
    })()
  `);
  await wait(1500);

  await capture(win, path.join(repoRoot, "dist", "island-preview-collapsed.png"));

  win.webContents.send("island:state", {
    expanded: false,
    page: "todo",
    attachMode: "floating",
    dockEdge: "top",
    size: { width: PANEL_WIDTH, height: BAR_HEIGHT },
    position: { x: 0, y: 0 },
  });
  await wait(600);
  await capture(win, path.join(repoRoot, "dist", "island-preview-collapsed-floating.png"));

  win.setSize(STRIP_WIDTH, PANEL_HEIGHT);
  win.webContents.send("island:state", {
    expanded: false,
    page: "todo",
    attachMode: "attached",
    dockEdge: "left",
    size: { width: STRIP_WIDTH, height: PANEL_HEIGHT },
    position: { x: 0, y: 0 },
  });
  await wait(600);
  await capture(win, path.join(repoRoot, "dist", "island-preview-strip-left.png"));

  win.setSize(PANEL_WIDTH, PANEL_HEIGHT);
  win.webContents.send("island:state", {
    expanded: true,
    page: "todo",
    attachMode: "attached",
    dockEdge: "left",
    size: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
    position: { x: 0, y: 0 },
  });
  await wait(900);
  await capture(win, path.join(repoRoot, "dist", "island-preview-expanded-left.png"));

  win.setSize(STRIP_WIDTH, PANEL_HEIGHT);
  win.webContents.send("island:state", {
    expanded: false,
    page: "todo",
    attachMode: "attached",
    dockEdge: "right",
    size: { width: STRIP_WIDTH, height: PANEL_HEIGHT },
    position: { x: 0, y: 0 },
  });
  await wait(600);
  await capture(win, path.join(repoRoot, "dist", "island-preview-strip-right.png"));

  win.setSize(PANEL_WIDTH, PANEL_HEIGHT);
  win.webContents.send("island:state", {
    expanded: true,
    page: "todo",
    attachMode: "attached",
    dockEdge: "top",
    size: { width: 400, height: 480 },
    position: { x: 0, y: 0 },
  });
  await wait(1200);
  await capture(win, path.join(repoRoot, "dist", "island-preview-expanded.png"));
  await dumpState(win, "[expanded]");

  win.webContents.send("island:state", {
    expanded: true,
    page: "clipboard",
    attachMode: "attached",
    size: { width: 400, height: 480 },
    position: { x: 0, y: 0 },
  });
  await wait(800);
  await capture(win, path.join(repoRoot, "dist", "island-preview-clipboard.png"));
  await dumpState(win, "[clipboard]");

  win.webContents.send("island:state", {
    expanded: true,
    page: "ai",
    attachMode: "attached",
    size: { width: 400, height: 480 },
    position: { x: 0, y: 0 },
  });
  await wait(1000);
  await capture(win, path.join(repoRoot, "dist", "island-preview-ai-sessions.png"));
  await dumpState(win, "[ai-sessions]");

  const opened = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector('.island-ai-session-open');
      if (!el) return 'no-session';
      el.click();
      return el.getAttribute('aria-label');
    })()
  `);
  await wait(1000);
  console.log("[opened]", opened);
  await capture(win, path.join(repoRoot, "dist", "island-preview-ai-chat.png"));
  await dumpState(win, "[ai-chat]");

  const typed = await win.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector('.island-chat-input');
      if (!el) return 'no-input';
      el.focus();
      document.execCommand('insertText', false, '那今天先做哪一条？');
      return el.value;
    })()
  `);
  await wait(600);
  console.log("[typed]", typed);
  await capture(win, path.join(repoRoot, "dist", "island-preview-ai.png"));
  await dumpState(win, "[ai]");

  const header = await win.webContents.capturePage({
    clip: { x: 0, y: 0, width: 400, height: 56 },
  });
  fs.writeFileSync(
    path.join(repoRoot, "dist", "island-preview-tabs-zoom.png"),
    header.resize({ width: 1200 }).toPNG()
  );
  console.log("wrote tabs zoom");

  win.destroy();
  app.quit();
});
