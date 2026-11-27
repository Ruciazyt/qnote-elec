
import { tool } from "../tool";
import { z } from 'zod';
import { log } from '../../../system/log';
import { extractTitle, fetchText, htmlToText } from './searchEngine';

function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export const webFetchTool = tool(
  async (input: { url: string; maxChars?: number }) => {
    const url = (input.url || '').trim();
    if (!url) {
      return '抓取失败：缺少 url。';
    }
    if (!isSafeUrl(url)) {
      return `抓取失败：只允许 http/https 链接，${url} 已拒绝。`;
    }
    const maxChars = Math.min(Math.max(input.maxChars ?? 4000, 500), 20000);

    try {
      const { text } = await fetchText(url, { timeoutMs: 20000 });
      const title = extractTitle(text);
      const body = htmlToText(text);
      log.info(`[ai-web] fetch ${url} -> ${body.length} chars`);

      if (!body) {
        return (
          `页面 ${url} 没抓到可读正文（可能内容由 JS 渲染）。` +
          '改用 browser_navigate 打开它，再 browser_get_snapshot 读取。'
        );
      }

      const sliced = body.slice(0, maxChars);
      const parts = [`标题：${title || '(无标题)'}`, `来源：${url}`, '', sliced];
      if (body.length > maxChars) {
        parts.push(`…（正文共 ${body.length} 字，已截断。需要更多请分段读或调大 maxChars）`);
      }
      return parts.join('\n');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error(`[ai-web] fetch failed ${url}: ${reason}`);
      return `抓取失败：${reason}。可以改用 browser_navigate + browser_get_snapshot。`;
    }
  },
  {
    name: 'web_fetch',
    description:
      '抓取一个网页并提取正文纯文本（去掉导航、脚本、样式），返回标题和正文。' +
      '适合读 web_search 找到的文章正文、官方文档。' +
      '页面内容靠 JS 渲染时抓不到正文，这时改用 browser_navigate + browser_get_snapshot。',
    schema: z.object({
      url: z.string().describe('要读取的网页完整地址，必须是 http/https'),
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(20000)
        .optional()
        .describe('可选：最多取多少字正文，默认 4000，最多 20000'),
    }),
  }
);
