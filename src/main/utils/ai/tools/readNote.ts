/**
 * read_note — 读取一篇笔记的正文
 *
 * 用途：AI 要修改某篇笔记时，先读回原文再改。
 * 不读就改等于凭想象重写，用户已编辑的内容会被无声抹掉。
 *
 * 只读文本类（markdown / html / excalidraw）。图片和 PDF 返回说明而不是内容 ——
 * 它们是二进制，转成 base64 塞进上下文毫无意义且会挤爆窗口。
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { NoteStore } from '../../../core/noteStore';
import { detectNoteType, getNoteTypeMeta } from '../../../../shared/noteTypes';
import { getToolContext } from './types';

/**
 * 超过这个长度就截断。
 *
 * 一篇超长笔记可能几万字，全量进上下文既贵又挤占后续工具调用的空间。
 * 截断时明确告知 AI「内容被截断」，避免它以为读到了全文而做出错误假设。
 */
const MAX_CHARS = 20000;

export const readNoteTool = tool(
  async (input: { path: string }) => {
    const ctx = getToolContext();

    if (!ctx.notes) {
      return JSON.stringify({ ok: false, error: '笔记功能尚未初始化。' });
    }

    const relPath = (input.path ?? "").trim();
    if (!relPath) {
      return JSON.stringify({ ok: false, error: 'path 不能为空。' });
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

    const type = detectNoteType(relPath);
    if (!type) {
      return JSON.stringify({
        ok: false,
        error: `不支持的笔记类型：${relPath}。请先用 list_notes 确认路径。`,
      });
    }

    // 二进制类型不返回正文 —— 转 base64 对模型没有意义
    if (type === 'image' || type === 'pdf') {
      return JSON.stringify({
        ok: false,
        error: `${getNoteTypeMeta(type).label}是二进制文件，无法作为文本读取。`,
        relPath,
        type,
      });
    }

    try {
      const store = new NoteStore();
      let text: string;
      if (type === 'markdown') {
        // 走 markdown 专用通道：主进程会把本地图片的相对路径换成 dataUrl
        text = store.readMarkdownWithAssets(root, relPath);
      } else if (type === 'html') {
        text = store.readHtmlWithAssets(root, relPath);
      } else {
        const content = store.read(root, relPath);
        text = content.type === 'excalidraw' ? content.text : '';
      }

      const truncated = text.length > MAX_CHARS;
      return JSON.stringify({
        ok: true,
        relPath,
        type,
        length: text.length,
        truncated,
        ...(truncated
          ? { note: `内容过长已截断（只返回前 ${MAX_CHARS} 字，共 ${text.length} 字），修改时注意不要丢失后半部分。` }
          : {}),
        content: truncated ? text.slice(0, MAX_CHARS) : text,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        ok: false,
        error: `读取失败：${reason}。文件可能已被移动或删除，请先用 list_notes 确认路径。`,
        relPath,
      });
    }
  },
  {
    name: 'read_note',
    description:
      '读取指定笔记的正文内容（Markdown / HTML / 白板）。' +
      '修改笔记前必须先读它 —— 不读原文直接改会覆盖掉用户已经编辑过的部分。',
    schema: z.object({
      path: z.string().describe('笔记的相对路径，如「方案.md」「工作/周报.html」。先用 list_notes 拿到准确值'),
    }),
  }
);