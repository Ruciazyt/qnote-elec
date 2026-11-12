/**
 * 灵动岛截图工具（临时）
 *
 * QNote 的 dev 实例没法用 CDP 连（/json/list 永远不返回），
 * 所以另起一个最小 Electron 应用：加载岛的真实产物 + 喂假数据，
 * 用 webContents.capturePage() 把收起态与展开态各截一张。
 *
 * 只开一个窗口：展开态靠改窗口尺寸 + 推一次 island:state 复现，
 * 不再二次 loadFile（同一进程里第二个窗口的 file:// 加载偶发 ERR_FAILED）。
 *
 * 用法：electron scripts/dev/capture-island-preview.js
 * 产物：dist/island-preview-*.png
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * 阴影留白 —— 窗口比卡片大一圈，阴影才有地方画
 *
 * 与 shared/island.ts 的 ISLAND_SHADOW_PAD_X / ISLAND_SHADOW_PAD_Y 同值。
 * 截图窗口要按这个放大，否则阴影会被窗口矩形裁掉（截出来就是那道硬边）。
 */
const PAD_X = 10;
const PAD_Y = 32;

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

/** AI 对话页的历史消息（默认 AI 会话里的） */
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
  ipcMain.handle("send-ai-agent-stream", () => ({ sessionId: "preview-session" }));
  ipcMain.on("island:set-collapsed-width", () => {});
  ipcMain.on("island:set-interactive", () => {});
  ipcMain.on("island:set-page", () => {});
  ipcMain.on("island:expand", () => {});
  ipcMain.on("island:collapse", () => {});
  ipcMain.on("island:toggle", () => {});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 打印一下当前状态：哪个页签高亮、面板里是哪个页 —— 截图对不上时先看这个 */
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
    width: 330 + PAD_X * 2,
    height: 44 + PAD_Y,
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
  // 窗口是隐藏的，合成器不产帧 —— CSS 过渡会冻在起始值上，
  // 截出来的静态图会停在动画中间（按钮显示成禁用色、面板半透明）。
  // 截图前把过渡关掉，让每张图都是最终态。
  await win.webContents.executeJavaScript(`
    (() => {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { transition: none !important; }';
      document.head.appendChild(style);
    })()
  `);
  await wait(1500);

  // ── 收起态 ──
  await capture(win, path.join(repoRoot, "dist", "island-preview-collapsed.png"));

  // ── 收起态（浮动态）—— 拖离屏幕顶边后是颗四角一样圆的药丸 ──
  win.webContents.send("island:state", {
    expanded: false,
    page: "todo",
    attachMode: "floating",
    size: { width: 330, height: 44 },
    position: { x: 0, y: 0 },
  });
  await wait(600);
  await capture(win, path.join(repoRoot, "dist", "island-preview-collapsed-floating.png"));

  // ── 展开态：改窗口尺寸 + 推一次状态 ──
  win.setSize(400 + PAD_X * 2, 480 + PAD_Y);
  win.webContents.send("island:state", {
    expanded: true,
    page: "todo",
    attachMode: "attached",
    size: { width: 400, height: 480 },
    position: { x: 0, y: 0 },
  });
  await wait(1200);
  await capture(win, path.join(repoRoot, "dist", "island-preview-expanded.png"));
  await dumpState(win, "[expanded]");

  // ── 展开态（剪贴板页签），顺带看另一个页签的排版 ──
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

  // ── 展开态（AI 对话页）—— 岛上能直接问，不用跳主窗口 ──
  win.webContents.send("island:state", {
    expanded: true,
    page: "ai",
    attachMode: "attached",
    size: { width: 400, height: 480 },
    position: { x: 0, y: 0 },
  });
  await wait(1000);
  // 在输入框里放一句话，看输入区（sticky 底栏）长什么样。
  // 用 execCommand 走真实的 input 事件 —— 直接改 .value 的话 React 的
  // 受控状态不同步，截图里会看到「有字但发送按钮是禁用的」这种假象。
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

  // ── 页签条放大图：肉眼分不清高亮落在哪个页签上时用它 ──
  const header = await win.webContents.capturePage({
    clip: { x: PAD_X, y: 0, width: 400, height: 56 },
  });
  fs.writeFileSync(
    path.join(repoRoot, "dist", "island-preview-tabs-zoom.png"),
    header.resize({ width: 1200 }).toPNG()
  );
  console.log("wrote tabs zoom");

  win.destroy();
  app.quit();
});
