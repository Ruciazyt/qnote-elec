
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { log } from '../../../system/log';
import { runWebSearch, type SearchEngineId } from './searchEngine';

const ENGINE_LABEL: Record<SearchEngineId, string> = {
  bing: 'Bing',
  baidu: '百度',
};

export const webSearchTool = tool(
  async (input: { query: string; engine?: SearchEngineId; count?: number }) => {
    const query = (input.query || '').trim();
    if (!query) {
      return '搜索失败：缺少关键词。';
    }
    const count = Math.min(Math.max(input.count ?? 5, 1), 10);
    const engine: SearchEngineId = input.engine === 'baidu' ? 'baidu' : 'bing';

    try {
      const outcome = await runWebSearch(query, engine, count);
      log.info(`[ai-web] search "${query}" via ${outcome.engine} -> ${outcome.results.length}`);

      if (outcome.results.length === 0) {
        return (
          `没搜到结果（关键词：${query}）。` +
          (outcome.warning ? `原因：${outcome.warning}。` : '') +
          '换个说法或更具体的关键词再试一次。'
        );
      }

      const lines = [`搜索「${query}」得到 ${outcome.results.length} 条结果（${ENGINE_LABEL[outcome.engine]}）：`];
      outcome.results.forEach((item, index) => {
        lines.push(`[${index + 1}] ${item.title}`, `    ${item.url}`);
        if (item.snippet) lines.push(`    ${item.snippet}`);
      });
      if (outcome.warning) lines.push(`（${outcome.warning}）`);
      lines.push('需要正文就用 web_fetch 打开对应链接。');
      return lines.join('\n');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error(`[ai-web] search failed: ${reason}`);
      return `搜索失败：${reason}。可以换个关键词，或改用 browser_navigate 打开搜索页。`;
    }
  },
  {
    name: 'web_search',
    description:
      '在互联网上搜索关键词，返回若干条结果的标题、链接和摘要。' +
      '不需要任何 API Key，直接抓公开搜索结果页（Bing / 百度）。' +
      '适合查最新资料、找官方文档、核实事实。' +
      '拿到链接后若要正文，用 web_fetch 打开那一条。',
    schema: z.object({
      query: z.string().describe('搜索关键词，用自然语言描述你要找的东西'),
      engine: z
        .enum(['bing', 'baidu'])
        .optional()
        .describe('可选：搜索引擎，默认 bing。中文本地内容可用 baidu'),
      count: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('可选：返回几条结果，默认 5，最多 10'),
    }),
  }
);
