/**
 * browser_* 工具的公共前置
 *
 * 所有 browser 工具都要先过这一关：
 *   - Agent 模式外 / 非 Electron 环境没有 browser 句柄
 *   - 用户可能根本没打开过浏览器标签页
 * 这两种情况返回结构化错误而不是抛异常，让模型能读到原因并改用别的路子，
 * 而不是拿到一句 "工具执行错误" 然后瞎试。
 */

import { getToolContext } from '../types';
import type { BrowserAutomation } from '../../../../core/window/browserAutomation';
import { log } from '../../../log';

export const NO_BROWSER_HINT =
  '浏览器不可用（应用主窗口可能已关闭）。请告知用户：标签页无法创建，需重新打开应用后重试。';

export function resolveBrowser(): BrowserAutomation | null {
  const { browser } = getToolContext();
  if (!browser || !browser.isAvailable()) return null;
  return browser;
}

/** 统一的失败返回格式 —— 一眼能看出是环境问题还是脚本问题 */
export function toolError(code: string, message: string, extra?: Record<string, unknown>) {
  return JSON.stringify({ ok: false, error: message, code, ...extra });
}

export interface ActionResult {
  ok: boolean;
  tag?: string;
  role?: string;
  value?: string;
  checked?: boolean;
  /** 事件派发出去了、但用户视角上「等于没点」的提醒（被遮挡、元素禁用等） */
  notice?: string;
  /** 脚本自报的错误码，缺省按「元素失效」处理 */
  code?: string;
  error?: string;
}

/**
 * 执行一次写操作并回报结果
 *
 * 点击 / 输入常常会引发页面跳转。一旦跳转，脚本所在的执行上下文就被销毁了，
 * executeJavaScript 会以 "Inspected target navigated" 之类的错误失败 ——
 * 但这时候恰恰说明操作**生效了**，不是失败了。
 * 所以这里把这类错误翻译成"已触发跳转"，等页面停下来再回报新的 URL，
 * 让模型拿到操作后的真实状态而不是一句报错。
 */
export async function runAction(
  browser: BrowserAutomation,
  code: string,
  opts: { waitMs?: number; audit: string }
): Promise<string> {
  let result: ActionResult;
  let navigated = false;

  try {
    result = await browser.execute<ActionResult>(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    navigated = /跳转|navigat|context/i.test(msg);
    if (!navigated) {
      return toolError('EXECUTE_FAILED', `操作失败：${msg}`);
    }
    result = { ok: true };
  }

  if (!result?.ok) {
    return toolError(result?.code ?? 'ELEMENT_STALE', result?.error ?? '元素操作失败，请重新获取页面快照。');
  }

  // 审计：写操作落应用日志，用户可回溯 AI 在页面上做过什么
  log.info(`[ai-browser] ${opts.audit}`, { url: browser.getActiveTab()?.url });

  // 点击后可能立刻开始加载，等一小会儿再取状态
  const settled = await browser.waitForIdle(opts.waitMs ?? 2000);
  const tab = browser.getActiveTab();

  const parts = [`操作成功。${navigated ? '（该操作触发了页面跳转）' : ''}`];
  if (result.tag) parts.push(`目标元素：<${result.tag}${result.role ? ` role=${result.role}` : ''}>`);
  if (typeof result.checked === 'boolean') parts.push(result.checked ? '当前为已勾选' : '当前为未勾选');
  if (result.value !== undefined) parts.push(`当前值：${result.value || '(空)'}`);
  if (tab) {
    parts.push(`当前页面：${tab.title || '(无标题)'}`);
    parts.push(`URL：${tab.url}`);
  }
  // 「派发出去了但用户点不到」——这类必须显式说，否则模型会以为成功并往下走
  if (result.notice) parts.push(`注意：${result.notice}`);
  if (!settled) parts.push('提示：页面似乎仍在加载，稍等后重新获取快照确认结果。');

  parts.push('请重新调用 browser_get_snapshot 确认下一步。');
  return parts.join('\n');
}
