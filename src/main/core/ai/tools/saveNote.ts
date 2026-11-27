import { tool } from "./tool";
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NoteStore } from "../../notes/noteStore";
import { withDefaultExt, detectNoteType, NoteType } from '../../../../shared/notes/noteTypes';
import { getToolContext } from "../toolContext";
import { log } from '../../system/log';

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g;

const ILLEGAL_FOLDER_CHARS = /[\\/:*?"<>|]/g;

function sanitizeName(raw: string, fallback: string): string {
  const cleaned = (raw ?? "").replace(ILLEGAL_NAME_CHARS, "").replace(/\s+/g, " ").trim();
  const trimmed = cleaned.replace(/^((?:[\s\S]*[^. ])?)[. ]+$/, "$1");
  return trimmed || fallback;
}

function allocateUniquePath(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  if (!fs.existsSync(abs)) return relPath;

  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath);
  const ext = path.posix.extname(base);
  const stem = base.slice(0, base.length - ext.length);

  for (let n = 2; n < 200; n += 1) {
    const candidate = path.posix.join(dir === "." ? "" : dir, `${stem}-${n}${ext}`);
    if (!fs.existsSync(path.resolve(root, candidate))) return candidate;
  }
  return relPath;
}

function appendToExisting(existing: string, addition: string, noteType: NoteType): string {
  const chunk = addition.trim();
  if (!chunk) return existing;
  if (noteType === "html") {
    const close = existing.lastIndexOf("</body>");
    if (close !== -1) {
      return `${existing.slice(0, close)}\n${chunk}\n${existing.slice(close)}`;
    }
  }
  return `${existing.trimEnd()}\n\n${chunk}\n`;
}

export const saveNoteTool = tool(
  async (input: {
    title?: string;
    content: string;
    type?: 'markdown' | 'html';
    folder?: string;
    path?: string;
    overwrite?: boolean;
    append?: boolean;
  }) => {
    const ctx = getToolContext();

    if (!ctx.notes) {
      return JSON.stringify({
        ok: false,
        error: '笔记功能尚未初始化，无法保存笔记。请稍后重试。',
      });
    }

    const content = input.content ?? "";
    if (!content.trim()) {
      return JSON.stringify({ ok: false, error: '内容为空，没有写入任何文件。' });
    }

    let root: string;
    try {
      root = await ctx.notes.getFilePath();
    } catch (err) {
      log.error('[save_note] 读取笔记根目录失败', err);
      return JSON.stringify({ ok: false, error: '读取笔记目录失败。' });
    }
    if (!root) {
      return JSON.stringify({
        ok: false,
        error: '用户还没有设置笔记保存目录。请先在笔记页左上角选择目录。',
      });
    }

    const noteType: NoteType = input.type === 'html' ? 'html' : 'markdown';

    if (input.path && input.path.trim()) {
      const relPath = input.path.trim();

      const resolved = path.resolve(root, relPath);
      if (!resolved.startsWith(path.resolve(root))) {
        return JSON.stringify({ ok: false, error: '目标路径超出了笔记目录范围，已拒绝写入。' });
      }

      const existingType = detectNoteType(relPath);
      if (!existingType) {
        return JSON.stringify({
          ok: false,
          error: `「${relPath}」不是受支持的笔记类型，无法更新。请先用 list_notes 确认路径。`,
        });
      }
      if (existingType !== noteType) {
        return JSON.stringify({
          ok: false,
          error: `路径「${relPath}」是 ${existingType} 类型，本次内容是 ${noteType}。` +
            `请改用 type: "${existingType}" 重试，或换一个 path。`,
        });
      }

      const exists = fs.existsSync(resolved);
      if (exists && !input.overwrite && !input.append) {
        return JSON.stringify({
          ok: false,
          error: `「${relPath}」已存在。要更新它必须显式传 overwrite: true。`,
          exists: true,
          relPath,
        });
      }
      if (!exists) {
        return JSON.stringify({
          ok: false,
          error: `「${relPath}」不存在，无法更新。请先用 list_notes 查看真实路径。`,
          exists: false,
          relPath,
        });
      }

      try {
        const noteStore = new NoteStore();
        const finalContent = input.append ? appendToExisting(fs.readFileSync(resolved, "utf-8"), content, noteType) : content;
        const ok =
          noteType === 'html'
            ? noteStore.writeHtmlWithAssets(root, relPath, finalContent)
            : noteStore.writeMarkdownWithAssets(root, relPath, finalContent);
        if (!ok) return JSON.stringify({ ok: false, error: `写入失败：${relPath}` });

        const entry = noteStore.stat(root, relPath);
        log.info(`[save_note] ${input.append ? "已续写" : "已更新"}笔记: ${relPath}`);
        const { broadcastNotesChanged } = await import('../../../handlers/notes/fileHandlers');
        broadcastNotesChanged(root);

        return JSON.stringify({
          ok: true,
          updated: true,
          appended: Boolean(input.append),
          name: entry?.name ?? path.posix.basename(relPath),
          relPath,
          type: noteType,
          bytes: entry?.size ?? content.length,
          message: `已${input.append ? '续写' : '更新'}笔记「${entry?.name ?? relPath}」。`,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error('[save_note] 更新失败', err);
        return JSON.stringify({ ok: false, error: `更新失败：${reason}` });
      }
    }

    if (!input.title || !input.title.trim()) {
      return JSON.stringify({
        ok: false,
        error: '新建笔记需要提供 title（或用 path 指定要更新的既有笔记）。',
      });
    }

    const rawName = sanitizeName(input.title, noteType === 'html' ? '未命名网页' : '未命名笔记');
    const fileName = withDefaultExt(rawName, noteType);

    let folder = '';
    if (input.folder && input.folder.trim()) {
      const cleaned = input.folder.trim().replace(ILLEGAL_FOLDER_CHARS, '').trim();
      if (cleaned.includes('/') || cleaned === '..' || cleaned === '.') {
        return JSON.stringify({
          ok: false,
          error: `folder 只支持单层文件夹名，收到的是「${input.folder}」。`,
        });
      }
      folder = cleaned;
    }

    let relPath = folder ? `${folder}/${fileName}` : fileName;
    const resolved = path.resolve(root, relPath);
    if (!resolved.startsWith(path.resolve(root))) {
      return JSON.stringify({ ok: false, error: '目标路径超出了笔记目录范围，已拒绝写入。' });
    }
    if (!detectNoteType(fileName)) {
      return JSON.stringify({ ok: false, error: `不支持的笔记类型: ${fileName}` });
    }

    relPath = allocateUniquePath(root, relPath);

    try {
      const noteStore = new NoteStore();
      const ok =
        noteType === 'html'
          ? noteStore.writeHtmlWithAssets(root, relPath, content)
          : noteStore.writeMarkdownWithAssets(root, relPath, content);

      if (!ok) {
        return JSON.stringify({ ok: false, error: `写入失败：${relPath}` });
      }

      const entry = noteStore.stat(root, relPath);
      log.info(`[save_note] 已保存笔记: ${relPath}`);

      const { broadcastNotesChanged } = await import('../../../handlers/notes/fileHandlers');
      broadcastNotesChanged(root);

      return JSON.stringify({
        ok: true,
        name: entry?.name ?? fileName,
        relPath,
        type: noteType,
        bytes: entry?.size ?? content.length,
        message: `已保存为笔记「${entry?.name ?? fileName}」，用户可以在笔记页查看和编辑。`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error('[save_note] 保存失败', err);
      return JSON.stringify({ ok: false, error: `保存失败：${reason}` });
    }
  },
  {
    name: 'save_note',
    description:
      '把内容保存为用户的笔记（Markdown 或 HTML），存进用户设置的笔记目录。' +
      '三种用法：' +
      '（1）新建 —— 传 title；' +
      '（2）更新既有笔记 —— 先 read_note 读回原文，改完传 path + overwrite:true；' +
      '（3）续写 —— 传 path + append:true，把 content 接到文件末尾，不动已有内容。' +
      '用户说"帮我整理成笔记""存到笔记里""把这篇笔记改一下"时使用。' +
      '笔记很长时用（3）分几轮写：一轮写不完就再调一次 append，别硬塞进一次调用。',
    schema: z.object({
      title: z
        .string()
        .optional()
        .describe('新建时的标题，同时作为文件名（不含扩展名，扩展名按 type 自动补）'),
      content: z.string().describe('笔记正文内容'),
      type: z
        .enum(['markdown', 'html'])
        .optional()
        .describe('笔记格式，默认 markdown。需要富排版/图表时用 html'),
      folder: z
        .string()
        .optional()
        .describe('新建时的可选子文件夹名（单层，不含斜杠）。不填则存到笔记根目录'),
      path: z
        .string()
        .optional()
        .describe('要更新的既有笔记路径（相对笔记根，如「方案.md」）。传了就更新那一个文件，不再新建'),
      overwrite: z
        .boolean()
        .optional()
        .describe('是否允许覆盖已存在的文件。更新既有笔记时必须为 true，默认 false'),
      append: z
        .boolean()
        .optional()
        .describe(
          '续写：把 content 追加到既有文件末尾，而不是整篇覆盖（不需要 overwrite）。' +
          '长笔记内容多到一次写不完时，分几轮 save_note 逐段追加，别硬塞进一次调用。'
        ),
    }),
  }
);