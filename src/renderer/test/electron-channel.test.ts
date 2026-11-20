import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MAIN_ROOT,
  PRELOAD_PATH,
  parseMainChannels,
  parseMainSendChannels,
  parsePreloadChannels,
} from "./electron-contract";


const preloadChannels = parsePreloadChannels(fs.readFileSync(PRELOAD_PATH, "utf8"));
const mainChannels = parseMainChannels(MAIN_ROOT);

describe("preload 通道在主进程都有接收方", () => {
  it("每个 invoke 通道都有对应的 ipcMain.handle", () => {
    const missing = preloadChannels.invoke.filter(
      (channel) => !mainChannels.handled.includes(channel)
    );
    expect(missing).toEqual([]);
  });

  it("每个 send 通道都有对应的 ipcMain.on", () => {
    const missing = preloadChannels.send.filter(
      (channel) => !mainChannels.listened.includes(channel)
    );
    expect(missing).toEqual([]);
  });

  it("没有非字面量通道（万能 send 不许再回来）", () => {
    expect(preloadChannels.dynamic).toEqual([]);
  });
});

describe("主进程扫描口径", () => {
  it("扫描范围含 index.ts 与 core/window 下的窗口文件", () => {
    expect(mainChannels.files).toContain("index.ts");
    expect(mainChannels.files).toContain("core/window/mainWindow.ts");
    expect(mainChannels.files).toContain("core/window/clipboard/clipboardPopup.ts");
    expect(mainChannels.files).toContain("handlers/notes/noteHandlers.ts");
  });

  it("注册点数量在合理量级（扫描没退化成空）", () => {
    expect(mainChannels.handled.length).toBeGreaterThan(150);
    expect(mainChannels.listened.length).toBeGreaterThan(5);
  });

  it("注册点的通道参数都是字面量（没有判不了的）", () => {
    expect(mainChannels.unresolved).toEqual([]);
  });

  it("窗口那几条通道确实被扫到了", () => {
    for (const channel of [
      "minimize-window",
      "maximize-window",
      "open-dev-tools",
      "popup-close",
      "popup-show-main-window",
    ]) {
      expect(mainChannels.listened).toContain(channel);
    }
  });
});

describe("守卫本身能抓断链（变异输入）", () => {

  it("preload 打到一个主进程没人接的通道 → 判为断链", () => {
    const channels = parsePreloadChannels(`contextBridge.exposeInMainWorld("electron", {
      ghost: () => ipcRenderer.invoke("ghost:channel"),
    });`);
    const missing = channels.invoke.filter((c) => !mainChannels.handled.includes(c));
    expect(missing).toEqual(["ghost:channel"]);
  });

  it("万能通道会被记成动态通道（静态判不了，不许混进通道名单）", () => {
    const channels = parsePreloadChannels(`contextBridge.exposeInMainWorld("electron", {
      send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
    });`);
    expect(channels.dynamic).toEqual([{ api: "send", kind: "send" }]);
    expect(channels.send).toEqual([]);
  });

  it("send 通道要的是 ipcMain.on，不是 ipcMain.handle", () => {
    const channels = parsePreloadChannels(`contextBridge.exposeInMainWorld("electron", {
      minimize: () => ipcRenderer.send("minimize-window"),
    });`);
    expect(channels.send).toEqual(["minimize-window"]);
    expect(mainChannels.listened).toContain("minimize-window");
    expect(mainChannels.handled).not.toContain("minimize-window");
  });
});


const BROADCAST_WHITELIST: { channel: string; why: string }[] = [
  {
    channel: "update:status",
    why: "core/update/updater.ts 走常量 UPDATE_STATUS_CHANNEL，经 broadcast() 转发",
  },
  {
    channel: "floating-ai:position-updated",
    why: "src/main/index.ts 的 broadcastToOthers 辅助函数",
  },
  {
    channel: "floating-ai:expanded-updated",
    why: "src/main/index.ts 的 broadcastToOthers 辅助函数",
  },
  {
    channel: "plugin:plugins-changed",
    why: "handlers/plugin/pluginHandlers.ts 的 broadcast 辅助函数",
  },
  {
    channel: "plugin:runtime-changed",
    why: "handlers/plugin/pluginHandlers.ts 的 broadcast 辅助函数",
  },
  {
    channel: "plugin:log",
    why: "handlers/plugin/pluginHandlers.ts 的 broadcast 辅助函数",
  },
  {
    channel: "plugin:notify",
    why: "handlers/plugin/pluginHandlers.ts 的 broadcast 辅助函数",
  },
  {
    channel: "browser:tabs-changed",
    why: "core/window/browser/browserViewManager.ts 的 send 辅助函数（channel 是参数）",
  },
  {
    channel: "browser:tab-updated",
    why: "core/window/browser/browserViewManager.ts 的 send 辅助函数（channel 是参数）",
  },
  {
    channel: "browser:load-error",
    why: "core/window/browser/browserViewManager.ts 的 send 辅助函数（channel 是参数）",
  },
];

const mainSends = parseMainSendChannels(MAIN_ROOT);
const directChannels = new Set(mainSends.direct);
const helperChannels = new Set(mainSends.helper);
const whitelistedChannels = new Set(BROADCAST_WHITELIST.map((w) => w.channel));

describe("主进程往渲染层发的通道", () => {
  it("preload 监听的每个通道，主进程都有发送点", () => {
    const missing = preloadChannels.listen.filter(
      (channel) => !directChannels.has(channel) && !whitelistedChannels.has(channel)
    );
    expect(missing).toEqual([]);
  });

  it("白名单里的通道在主进程追得到发送点（不能白嫖）", () => {
    const untraceable = BROADCAST_WHITELIST.filter(
      (w) => !directChannels.has(w.channel) && !helperChannels.has(w.channel)
    );
    expect(untraceable.map((w) => w.channel)).toEqual([]);
  });

  it("白名单没有陈旧条目（主进程已经不发的通道要从名单里删掉）", () => {
    const stale = BROADCAST_WHITELIST.filter(
      (w) => !mainSends.direct.includes(w.channel) && !mainSends.helper.includes(w.channel)
    );
    expect(stale.map((w) => w.channel)).toEqual([]);
  });

  it("变异输入：没登记过的监听通道会被判为缺发送点", () => {
    const ghost = parsePreloadChannels(`contextBridge.exposeInMainWorld("electron", {
      onGhost: (cb: any) => { ipcRenderer.on("ghost:channel", cb); },
    });`);
    const missing = ghost.listen.filter(
      (channel) => !directChannels.has(channel) && !whitelistedChannels.has(channel)
    );
    expect(missing).toEqual(["ghost:channel"]);
  });

  it("变异输入：常量通道名也算直接发（updater 的 UPDATE_STATUS_CHANNEL）", () => {
    const updater = fs.readFileSync(path.join(MAIN_ROOT, "core/update/updater.ts"), "utf8");
    expect(updater).toContain('const UPDATE_STATUS_CHANNEL = "update:status"');
    expect(mainSends.direct).toContain("update:status");
  });
});
