
import type { WebContents } from "electron";
import {
  getActiveWebContents,
  getActiveTabId,
  ensureTab,
  loadUrl,
  navigate,
} from "./browserViewManager";
import { log } from "../../system/log";

export interface ActiveTabInfo {
  id: string;
  url: string;
  title: string;
  loading: boolean;
}

export interface BrowserAutomation {
  isAvailable(): boolean;
  getActiveTab(): ActiveTabInfo | null;
  execute<T>(code: string): Promise<T>;
  waitForIdle(timeoutMs?: number): Promise<boolean>;
  go(action: "back" | "forward" | "reload" | "stop"): void;
  goTo(url: string): void;
}

function activeTabInfo(wc: WebContents, id: string): ActiveTabInfo {
  return {
    id,
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
  };
}

function ensureAutomationTab(): boolean {
  if (getActiveWebContents()) return true;
  try {
    ensureTab();
  } catch (err) {
    log.warn("无法为 AI 准备浏览器标签页", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  return getActiveWebContents() !== null;
}

export const browserAutomation: BrowserAutomation = {
  isAvailable() {
    return ensureAutomationTab();
  },

  getActiveTab() {
    const wc = getActiveWebContents();
    const id = getActiveTabId();
    return wc && id ? activeTabInfo(wc, id) : null;
  },

  async execute<T>(code: string): Promise<T> {
    const wc = getActiveWebContents();
    if (!wc) {
      throw new Error("当前没有可操控的浏览器页面（用户可能未打开浏览器标签页）");
    }
    try {
      return (await wc.executeJavaScript(code, true)) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Script failed to execute|Cannot find context|Inspected target navigated/i.test(msg)) {
        throw new Error("页面正在跳转，脚本未能执行。请等待页面加载完成后重新获取快照再操作。");
      }
      log.warn("浏览器脚本执行失败", { message: msg });
      throw err;
    }
  },

  waitForIdle(timeoutMs = 3000) {
    const wc = getActiveWebContents();
    if (!wc) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let grace: ReturnType<typeof setTimeout> | null = null;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (grace) clearTimeout(grace);
        wc.off("did-stop-loading", onDone);
        wc.off("did-fail-load", onDone);
        wc.off("destroyed", onDone);
        resolve(ok);
      };
      const onDone = () => finish(true);

      wc.on("did-stop-loading", onDone);
      wc.on("did-fail-load", onDone);
      wc.on("destroyed", onDone);

      timer = setTimeout(() => finish(false), timeoutMs);

      grace = setTimeout(() => {
        if (!wc.isDestroyed() && !wc.isLoading()) finish(true);
      }, 150);
    });
  },

  go(action) {
    const id = getActiveTabId();
    if (!id) throw new Error("当前没有可操控的浏览器页面");
    navigate(id, action);
  },

  goTo(url) {
    const id = getActiveTabId();
    if (!id) throw new Error("当前没有可操控的浏览器页面");
    loadUrl(id, url);
  },
};
