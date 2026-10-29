/**
 * 浏览器自动化句柄 — AI 工具层与内嵌浏览器之间唯一的接口
 *
 * 为什么单独一层：
 *   browserViewManager 是"应用功能"的模块（标签池、显隐、边界），
 *   AI 工具不该直接碰它的内部状态，否则 AI 能力会顺带获得
 *   "随便开标签 / 关掉用户标签" 这类它并不需要也不该有的权限。
 *
 * 这里刻意只暴露四件事：
 *   1. 当前有没有页面可操控
 *   2. 在**用户当前看着的那个**页面执行脚本（executeJavaScript，主进程内完成）
 *   3. 等页面加载停（避免点击后拿到上一页的结果）
 *   4. 前进/后退/刷新/跳转
 *
 * 不暴露：新建标签、关闭标签、tabId 寻址、切标签。
 * AI 想换页面只能导航当前页 —— 用户始终能一眼看到 AI 在干什么。
 *
 * 安全前提（已在 CDP 实验中验证）：
 *   - 网页侧 window.electron / require / process 均不可达（sandbox:true + contextIsolation）
 *   - executeJavaScript 在主进程内执行，不需要暴露 remote-debugging 端口
 */

import type { WebContents } from "electron";
import {
  getActiveWebContents,
  getActiveTabId,
  ensureTab,
  loadUrl,
  navigate,
} from "./browserViewManager";
import { log } from "../../utils/log";

export interface ActiveTabInfo {
  id: string;
  url: string;
  title: string;
  loading: boolean;
}

/** AI 工具能对内嵌浏览器做的全部动作 */
export interface BrowserAutomation {
  isAvailable(): boolean;
  getActiveTab(): ActiveTabInfo | null;
  /** 在活动标签页执行表达式脚本，返回页面的求值结果 */
  execute<T>(code: string): Promise<T>;
  /** 等待加载停止；返回 false 表示超时（调用方按"结果未知"处理，不要当成失败） */
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

/**
 * 保证至少存在一个可操作的活动标签
 *
 * 标签页原先只由渲染进程的 browser:get-state 创建，也就是**用户必须先手动
 * 打开过浏览器页**。但标签的 webContents 其实活在主进程里，跟浏览器页
 * 有没有被挂载无关 —— 所以 AI 完全可以在用户停在主页/笔记时自行建一个，
 * 不该把"先打开浏览器页"这种前置条件甩给用户。
 */
function ensureAutomationTab(): boolean {
  if (getActiveWebContents()) return true;
  try {
    ensureTab();
  } catch (err) {
    // 只有主窗口不可用时才会走到这，属于真的做不了
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
    // userGesture=true：让页面认为这次脚本执行来自用户手势，
    // 少数站点（需要授权的剪贴板、受限弹窗）只认真实手势。
    try {
      return (await wc.executeJavaScript(code, true)) as T;
    } catch (err) {
      // 页面在执行途中跳转是最常见的失败原因，给出可操作的提示而不是原始 Chromium 报错
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

      // 先挂监听再判断，否则可能"刚检查完还没加载完、事件就被我们错过了"
      wc.on("did-stop-loading", onDone);
      wc.on("did-fail-load", onDone);
      wc.on("destroyed", onDone);

      timer = setTimeout(() => finish(false), timeoutMs);

      // loadURL / 点击触发的导航都是异步发起的，紧跟着调用时 isLoading() 往往还是 false。
      // 不给这个窗口就会把"还没开始加载"误判成"已经加载完成"，导致读到跳转前的旧 URL。
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
