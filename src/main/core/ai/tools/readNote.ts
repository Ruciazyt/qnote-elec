import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { NoteStore } from "../../notes/noteStore";
import { detectNoteType, getNoteTypeMeta } from '../../../../shared/notes/noteTypes';
import { getToolContext } from "../toolContext";

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