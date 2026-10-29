/**
 * browser_fill — 向快照里的某个输入框写入文本
 *
 * 写工具：受设置里的「AI 写工具」开关控制（默认关闭）。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildFillScript, MAX_REF_INDEX } from './pageScripts';
import { NO_BROWSER_HINT, resolveBrowser, runAction, toolError } from './shared';

/** 防止模型把整篇文章灌进一个搜索框 */
const MAX_TEXT = 2000;

export const browserFillTool = tool(
  async (input: { index: number; text: string }) => {
    const browser = resolveBrowser();
    if (!browser) return toolError('NO_BROWSER', NO_BROWSER_HINT);

    const index = Number(input.index);
    if (!Number.isInteger(index) || index < 0 || index > MAX_REF_INDEX) {
      return toolError('BAD_INDEX', `元素编号 ${input.index} 不合法，请使用 browser_get_snapshot 返回的编号。`);
    }

    const text = String(input.text ?? '');
    if (text.length > MAX_TEXT) {
      return toolError('TEXT_TOO_LONG', `输入内容超过 ${MAX_TEXT} 字，已拒绝执行。请缩短后再试。`);
    }

    // 输入通常不触发跳转，等待时间可以短一些，但搜索框的联想/校验可能仍在异步进行
    return runAction(browser, buildFillScript(index, text), {
      audit: `fill #${index} (${text.length} 字)`,
      waitMs: 1200,
    });
  },
  {
    name: 'browser_fill',
    description:
      '向内嵌浏览器当前页面的某个输入框 / 搜索框 / 富文本编辑区 / 下拉框写入内容（会先清空原有内容）。' +
      '也支持 Shadow DOM 和同源 iframe 内的元素。下拉框请传选项的可见文字，匹配不到会返回可选值列表。' +
      '必须先用 browser_get_snapshot 获取页面并确认目标元素编号；快照里标了「已有内容」说明该框已经有字，' +
      '本次调用会覆盖它，除非你确实想替换。' +
      '仅填入内容，不会自动提交表单；需要提交时再用 browser_click 点击对应的提交按钮。',
    schema: z.object({
      index: z.number().int().min(0).max(MAX_REF_INDEX).describe('browser_get_snapshot 返回的元素编号'),
      text: z.string().max(MAX_TEXT).describe('要填入的文本，会覆盖原有内容'),
    }),
  }
);
