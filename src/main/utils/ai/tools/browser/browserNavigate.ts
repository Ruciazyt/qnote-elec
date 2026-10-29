/**
 * browser_navigate — 跳转 / 后退 / 前进 / 刷新
 *
 * 写工具：受设置里的「AI 写工具」开关控制（默认关闭）。
 *
 * 只导航**用户当前正在看的那个标签页** —— 不新建标签、不关标签。
 * 用户全程能看见 AI 把自己的页面翻到哪里去了。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { log } from '../../../log';
import { NO_BROWSER_HINT, resolveBrowser, toolError } from './shared';

/** 只放行 http/https，和内嵌浏览器的协议拦截保持一致 */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export const browserNavigateTool = tool(
  async (input: { action: 'url' | 'back' | 'forward' | 'reload'; url?: string }) => {
    const browser = resolveBrowser();
    if (!browser) return toolError('NO_BROWSER', NO_BROWSER_HINT);

    const action = input.action ?? 'url';

    if (action === 'url') {
      const url = String(input.url ?? '').trim();
      if (!url) {
        return toolError('MISSING_URL', '跳转需要提供 url 参数。');
      }
      if (!isSafeUrl(url)) {
        return toolError(
          'UNSAFE_URL',
          `拒绝跳转到 ${url}：只允许 http/https 链接（file://、javascript: 等本地协议一律不执行）。`
        );
      }
      browser.goTo(url);
    } else {
      browser.go(action);
    }

    log.info(`[ai-browser] navigate ${action}`, { url: input.url });

    const settled = await browser.waitForIdle(5000);
    const tab = browser.getActiveTab();
    if (!tab) {
      return toolError('TAB_GONE', '跳转后浏览器标签页已不存在。');
    }

    const lines = [
      settled ? '跳转完成。' : '已发出跳转指令，但页面在 5 秒内仍未加载完成，可能网络较慢。',
      `当前页面：${tab.title || '(无标题)'}`,
      `URL：${tab.url}`,
      '请调用 browser_get_snapshot 查看跳转后的页面内容。',
    ];
    return lines.join('\n');
  },
  {
    name: 'browser_navigate',
    description:
      '控制内嵌浏览器的当前标签页：打开指定 URL，或后退 / 前进 / 刷新。' +
      '只操作用户当前正在看的那一个标签页，不会新开或关闭标签页。',
    schema: z.object({
      action: z
        .enum(['url', 'back', 'forward', 'reload'])
        .describe("url=打开链接，back=后退，forward=前进，reload=刷新"),
      url: z.string().optional().describe('仅 action=url 时必填，必须是 http/https 开头的完整地址'),
    }),
  }
);
