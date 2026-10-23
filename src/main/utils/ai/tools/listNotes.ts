/**
 * list_notes — 列出用户笔记目录下的笔记
 *
 * 用途：AI 在修改某篇笔记前，先知道有哪些笔记、分别叫什么。
 * 没有这一步，AI 只能猜文件名，overwrite 就成了盲写。
 *
 * 只返回元数据不返回正文 —— 正文走 read_note 按需读取，
 * 避免一次调用把整个目录的内容灌进上下文。
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { NoteStore } from '../../../core/noteStore';
import { NoteType } from '../../../../shared/noteTypes';
import { getToolContext } from './types';

export const listNotesTool = tool(
  async (input: { type?: 'markdown' | 'html' | 'excalidraw' | 'image' | 'pdf'; folder?: string }) => {
    const ctx = getToolContext();

    if (!ctx.notes) {
      return JSON.stringify({ ok: false, error: '笔记功能尚未初始化。' });
    }

    let root: string;
    try {
      root = await ctx.notes.getFilePath();
    } catch {
      return JSON.stringify({ ok: false, error: '读取笔记目录失败。' });
    }
    if (!root) {
      return JSON.stringify({
        ok: false,
        error: '用户还没有设置笔记保存目录。请先在笔记页左上角选择目录。',
      });
    }

    try {
      const store = new NoteStore();
      const all = NoteStore.collectFiles(store.tree(root));

      // folder 传了就只看该子文件夹下的（AI 常用它把范围收窄）
      const prefix = input.folder && input.folder.trim() ? input.folder.trim().replace(/\/+$/, '') : '';
      let items = all;
      if (prefix) {
        items = all.filter((n) => n.relPath === prefix || n.relPath.startsWith(`${prefix}/`));
      }
      if (input.type) {
        items = items.filter((n) => n.type === (input.type as NoteType));
      }

      return JSON.stringify({
        ok: true,
        root,
        count: items.length,
        items: items.map((n) => ({
          relPath: n.relPath,
          name: n.name,
          type: n.type,
          ext: n.ext,
          size: n.size,
          mtime: n.mtime,
        })),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: `列出笔记失败：${reason}` });
    }
  },
  {
    name: 'list_notes',
    description:
      '列出用户笔记目录下的笔记（只含文件名、类型、路径和修改时间，不含正文）。' +
      '在修改某篇笔记前先用它确认真实存在的 relPath —— 文件名由用户自己定，猜不得。',
    schema: z.object({
      type: z
        .enum(['markdown', 'html', 'excalidraw', 'image', 'pdf'])
        .optional()
        .describe('可选：只列某一类笔记'),
      folder: z.string().optional().describe('可选：只看某个子文件夹下的笔记'),
    }),
  }
);