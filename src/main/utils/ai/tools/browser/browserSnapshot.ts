/**
 * browser_get_snapshot — 读取内嵌浏览器当前页面的可交互元素（带编号）
 *
 * 这是所有浏览器操作的第一步，也是唯一的信息入口。
 *
 * 返回给模型的是**紧凑文本**而不是 JSON：
 * 快照体积直接进模型上下文，省下的每一条都要靠 token。
 * 格式参考 browser-use：每行 `[编号] 角色 "标签"`。
 *
 * 元素抽取的字段模型对齐了腾讯 BrowserSkill 的 `packages/vom`：
 * nearbyText / inputState / sensitive / inert / checked=mixed / 遮挡标注，
 * 外加 open Shadow DOM 与同源 iframe 的递归遍历。全部走纯 executeJavaScript，不接 CDP。
 *
 * 它被归为只读工具，但会在页面上留下 `data-qnote-ref` 编号属性 ——
 * 这是"读"和"能用编号操作"之间的必要中间态：不改动页面内容、不触发任何事件，
 * 下一次快照会先清掉旧标记，页面上不留痕迹。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildSnapshotScript, type PageSnapshot, type SnapshotElement } from './pageScripts';
import { NO_BROWSER_HINT, resolveBrowser, toolError } from './shared';

/** 页面正文摘要上限（字符）—— 再多对决策没有帮助，只会挤占上下文 */
const TEXT_LIMIT = 1200;

/** 快照 token 预算范围 */
const MIN_TOKENS = 500;
const MAX_TOKENS = 12000;
const DEFAULT_TOKENS = 3000;

/**
 * 单行渲染 —— 每个字段都占 token，所以只在「能改变模型决策」时才输出
 *
 * 标注约定：
 *   【被遮挡】模型必须先关掉浮层再点，否则点了没反应
 *   inert      浏览器不会派发交互，别浪费一轮
 *   敏感字段   不该读取/回显，也不该拿它当搜索词
 *   (iframe#n) 元素在同源 iframe 里；如果目标在跨源 iframe 里，快照会给出 note
 */
function renderElement(e: SnapshotElement): string {
  const role = e.role || e.tag;
  let line = `[${e.index}] ${role} "${e.label}"`;
  if (e.type) line += ` type=${e.type}`;
  if (e.checked !== undefined) {
    line += e.checked === 'mixed' ? ' 半选' : e.checked ? ' 已勾选' : ' 未勾选';
  }
  if (e.inputState) line += e.inputState === 'empty' ? ' 空' : ' 已有内容';
  if (e.value) line += ` value="${e.value}"`;
  if (e.href) line += ` href=${e.href}`;
  if (e.disabled) line += ' 不可用';
  if (e.inert) line += ' inert';
  if (e.sensitive) line += ' 敏感字段';
  if (e.nearbyText) line += ` ~"${e.nearbyText}"`;

  const scope: string[] = [];
  if (e.shadow) scope.push('shadow');
  if (e.frame) scope.push(`iframe#${e.frame}`);
  if (scope.length) line += ` (${scope.join(' ')})`;

  if (e.occludedBy) line += ` 【被遮挡：${e.occludedBy}】`;
  return line;
}

export const browserGetSnapshotTool = tool(
  async (input: { maxTokens?: number }) => {
    const browser = resolveBrowser();
    if (!browser) return toolError('NO_BROWSER', NO_BROWSER_HINT);

    const maxTokens = Math.min(Math.max(input.maxTokens ?? DEFAULT_TOKENS, MIN_TOKENS), MAX_TOKENS);

    let snapshot: PageSnapshot;
    try {
      snapshot = await browser.execute<PageSnapshot>(
        buildSnapshotScript({ maxTokens, maxElements: 400, maxDepth: 4 })
      );
    } catch (err) {
      return toolError(
        'EXECUTE_FAILED',
        `读取页面失败：${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!snapshot || typeof snapshot !== 'object') {
      return toolError('BAD_SNAPSHOT', '页面快照返回异常，可能是页面脚本被站点改写或 CSP 干扰。');
    }

    const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
    const notes = Array.isArray(snapshot.notes) ? snapshot.notes : [];

    const lines: string[] = [];
    lines.push(`当前页面：${snapshot.title || '(无标题)'}`);
    lines.push(`URL：${snapshot.url}`);

    if (elements.length === 0) {
      lines.push('');
      lines.push(
        '可交互元素：（无）—— 该页面可能未加载完、是一个纯阅读页，或所有内容都在跨源 iframe 内（见下方提示）。'
      );
    } else {
      lines.push('');
      lines.push(`可交互元素（${elements.length} 个，用编号操作）：`);
      for (const el of elements) lines.push(renderElement(el));
      if (snapshot.truncated) {
        lines.push(`… 已截断，页面共命中 ${snapshot.totalInteractive ?? '?'} 个可交互元素。`);
      }
    }

    if (snapshot.text) {
      lines.push('');
      lines.push(`页面文本（截取 ${Math.min(snapshot.text.length, TEXT_LIMIT)} 字）：`);
      lines.push(snapshot.text.slice(0, TEXT_LIMIT));
    }

    if (notes.length) {
      lines.push('');
      for (const n of notes) lines.push(`提示：${n}`);
    }

    lines.push('');
    lines.push(
      `本次快照约 ${snapshot.estTokens ?? '?'} token。下一步用 browser_click / browser_fill 按编号操作；` +
        '页面可能变化，操作后请重新获取快照。'
    );
    return lines.join('\n');
  },
  {
    name: 'browser_get_snapshot',
    description:
      '读取内嵌浏览器当前活动标签页的快照：页面标题、URL、编号化的可交互元素列表（按钮/链接/输入框等）以及页面文本摘要。' +
      '会穿透 open Shadow DOM 和同源 iframe；被弹窗/遮罩挡住的元素会标注【被遮挡】，含密码、验证码等内容的字段会标注「敏感字段」。' +
      '在执行任何浏览器点击、输入、跳转之前，必须先调用本工具获取最新编号。编号只在本次快照后有效，页面一跳转就要重新获取。',
    schema: z.object({
      maxTokens: z
        .number()
        .int()
        .min(MIN_TOKENS)
        .max(MAX_TOKENS)
        .optional()
        .describe(
          `本次快照允许占用的上下文 token 预算，${MIN_TOKENS}-${MAX_TOKENS}，默认 ${DEFAULT_TOKENS}。` +
            '元素过多时会按这个预算截断并给出提示；页面简单时不用传。'
        ),
    }),
  }
);
