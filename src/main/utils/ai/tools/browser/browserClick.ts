/**
 * browser_click — 点击快照里的某个编号元素
 *
 * 写工具：受设置里的「AI 写工具」开关控制（默认关闭）。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildClickScript, MAX_REF_INDEX } from './pageScripts';
import { NO_BROWSER_HINT, resolveBrowser, runAction, toolError } from './shared';

export const browserClickTool = tool(
  async (input: { index: number }) => {
    const browser = resolveBrowser();
    if (!browser) return toolError('NO_BROWSER', NO_BROWSER_HINT);

    const index = Number(input.index);
    if (!Number.isInteger(index) || index < 0 || index > MAX_REF_INDEX) {
      return toolError('BAD_INDEX', `元素编号 ${input.index} 不合法，请使用 browser_get_snapshot 返回的编号。`);
    }

    return runAction(browser, buildClickScript(index), { audit: `click #${index}` });
  },
  {
    name: 'browser_click',
    description:
      '点击内嵌浏览器当前页面上的某个可交互元素（链接、按钮、复选框、菜单项等），也支持 Shadow DOM 和同源 iframe 内的元素。' +
      '必须先用 browser_get_snapshot 获取页面，再用它返回的编号调用本工具。' +
      '如果快照里元素标了【被遮挡】，说明页面上有弹窗或遮罩挡着，应该先把它关掉再点目标元素。' +
      '如果工具返回"编号已失效"，说明页面跳转或重新渲染了，需要重新获取快照。',
    schema: z.object({
      index: z.number().int().min(0).max(MAX_REF_INDEX).describe('browser_get_snapshot 返回的元素编号'),
    }),
  }
);
