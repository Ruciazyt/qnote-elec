
import { getToolContext } from "../../toolContext";
import type { BrowserAutomation } from "../../../window/browser/browserAutomation";
import { log } from '../../../system/log';

export const NO_BROWSER_HINT =
  '浏览器不可用（应用主窗口可能已关闭）。请告知用户：标签页无法创建，需重新打开应用后重试。';

export function resolveBrowser(): BrowserAutomation | null {
  const { browser } = getToolContext();
  if (!browser || !browser.isAvailable()) return null;
  return browser;
}

export function toolError(code: string, message: string, extra?: Record<string, unknown>) {
  return JSON.stringify({ ok: false, error: message, code, ...extra });
}

export interface ActionResult {
  ok: boolean;
  tag?: string;
  role?: string;
  value?: string;
  checked?: boolean;
  notice?: string;
  code?: string;
  error?: string;
}

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

  log.info(`[ai-browser] ${opts.audit}`, { url: browser.getActiveTab()?.url });

  const settled = await browser.waitForIdle(opts.waitMs ?? 2000);
  const tab = browser.getActiveTab();

  const parts = [`操作成功。${navigated ? '（该操作触发了页面跳转）' : ''}`];
  if (result.tag) parts.push(`目标元素：<${result.tag}${result.role ? " role=" + result.role : ''}>`);
  if (typeof result.checked === 'boolean') parts.push(result.checked ? '当前为已勾选' : '当前为未勾选');
  if (result.value !== undefined) parts.push(`当前值：${result.value || '(空)'}`);
  if (tab) {
    parts.push(`当前页面：${tab.title || '(无标题)'}`, `URL：${tab.url}`);
  }
  if (result.notice) parts.push(`注意：${result.notice}`);
  if (!settled) parts.push('提示：页面似乎仍在加载，稍等后重新获取快照确认结果。');

  parts.push('请重新调用 browser_get_snapshot 确认下一步。');
  return parts.join('\n');
}
