/**
 * save_note — AI 把生成的内容存成笔记
 *
 * 用户场景：AI 基于剪贴板 / 网页 / 对话内容整理出一篇笔记，
 * 调用本工具落盘，笔记页里立刻就能看到并继续编辑。
 *
 * 两种用法：
 *   - **新建**（默认）：给 title，走 allocateUniquePath，同名自动追加 -2/-3。
 *   - **更新已有**：给 path + overwrite=true，精准覆盖那一个文件。
 *     更新前应当先 read_note 读回原文，否则等于凭想象重写、
 *     抹掉用户已编辑的部分。
 *
 * 关键设计：
 *   1. **默认不覆盖**。AI 重试是常态（模型常会先规划再执行），
 *      静默覆盖会把用户上一版笔记冲掉，而用户无从察觉内容变了。
 *      要覆盖必须显式传 overwrite=true，这是有意的摩擦。
 *   2. **类型由扩展名决定**，与笔记系统其余部分一致；
 *      html 走 writeHtmlWithAssets，dataUrl 图片会抽进 assets/。
 *   3. **路径必须落在笔记根内**，越界（../）一律拒绝。
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'node:path';
import { NoteStore } from '../../../core/noteStore';
import { withDefaultExt, detectNoteType, NoteType } from '../../../../shared/noteTypes';
import { getToolContext } from './types';
import { log } from '../../log';

/** 文件名里 Windows 不允许的字符 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g;

/** 子文件夹名同样不能含路径分隔符，否则会被 resolveSafe 当成多级路径 */
const ILLEGAL_FOLDER_CHARS = /[\\/:*?"<>|]/g;

/** 清洗文件名：去非法字符、去首尾空白和点、空则回退到默认值 */
function sanitizeName(raw: string, fallback: string): string {
  const cleaned = (raw ?? "").replace(ILLEGAL_NAME_CHARS, "").replace(/\s+/g, " ").trim();
  // 结尾的点 / 空格在 Windows 上会被系统悄悄丢掉，导致回读的路径对不上
  // （^ 锚住 + 捕获前缀，避免未锚定正则的 O(n²) 回溯，见 SonarCloud S8786）
  const trimmed = cleaned.replace(/^((?:[\s\S]*[^. ])?)[. ]+$/, "$1");
  return trimmed || fallback;
}

/**
 * 在同级目录下找一个不冲突的路径。
 *
 * 不覆盖已有文件：文件名后缀依次尝试 `-2`、`-3` …
 */
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
  // 200 个同名基本意味着目录被脚本刷了，交给写失败去报错
  return relPath;
}

/**
 * 把新的一段接到已有正文后面。
 *
 * markdown 直接空行拼接。html 不能裸拼 —— 两份完整文档叠在一起浏览器只认第一份，
 * 所以插到 `</body>` 之前；没有 `</body>` 的片段文档才退回裸拼。
 */
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
    /** 要更新的既有笔记路径（相对笔记根）。给了就更新那一个文件 */
    path?: string;
    /** 是否允许覆盖已有文件。默认 false */
    overwrite?: boolean;
    /** 续写：把 content 追加到既有文件末尾，而不是整篇覆盖。长笔记分几轮写时用 */
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

    // 笔记根目录 —— FileWriter 是真值源（它内部处理了未设置时的回退）
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

    /** 更新既有笔记：path 已给定，直接覆盖（受 overwrite 与类型检查约束） */
    if (input.path && input.path.trim()) {
      const relPath = input.path.trim();

      // 越界拦截。放在最前面：路径穿越比什么都严重
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
      // append 是 overwrite 的替代语义：续写而不是整篇覆盖，因此不需要显式 overwrite
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
        // 续写：把已有正文读回来接上新内容再整体落盘。
        // 单次调用的 content 因此可以只装一小段 —— 模型分几轮写长笔记时不会撞输出上限。
        const finalContent = input.append ? appendToExisting(fs.readFileSync(resolved, "utf-8"), content, noteType) : content;
        const ok =
          noteType === 'html'
            ? noteStore.writeHtmlWithAssets(root, relPath, finalContent)
            : noteStore.writeMarkdownWithAssets(root, relPath, finalContent);
        if (!ok) return JSON.stringify({ ok: false, error: `写入失败：${relPath}` });

        const entry = noteStore.stat(root, relPath);
        log.info(`[save_note] ${input.append ? "已续写" : "已更新"}笔记: ${relPath}`);
        const { broadcastNotesChanged } = await import('../../../handlers/fileHandlers');
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

    // 新建路径：必须有 title
    if (!input.title || !input.title.trim()) {
      return JSON.stringify({
        ok: false,
        error: '新建笔记需要提供 title（或用 path 指定要更新的既有笔记）。',
      });
    }

    // 文件名：补默认扩展名 + 清洗非法字符
    const rawName = sanitizeName(input.title, noteType === 'html' ? '未命名网页' : '未命名笔记');
    const fileName = withDefaultExt(rawName, noteType);

    // 子文件夹：只允许单层，非法字符清掉后若为空则退回根目录
    let folder = '';
    if (input.folder && input.folder.trim()) {
      const cleaned = input.folder.trim().replace(ILLEGAL_FOLDER_CHARS, '').trim();
      // 含 "/" 说明调用方想传多级路径，这里不支持 —— 明确报错好过静默存错位置
      if (cleaned.includes('/') || cleaned === '..' || cleaned === '.') {
        return JSON.stringify({
          ok: false,
          error: `folder 只支持单层文件夹名，收到的是「${input.folder}」。`,
        });
      }
      folder = cleaned;
    }

    // 拼 relPath 并做一次越界校验（resolveSafe 之外的前置拦截，给出更友好的原因）
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
      // html 走带资源抽离的通道，正文里内嵌的 dataUrl 图会被存进 assets/
      const ok =
        noteType === 'html'
          ? noteStore.writeHtmlWithAssets(root, relPath, content)
          : noteStore.writeMarkdownWithAssets(root, relPath, content);

      if (!ok) {
        return JSON.stringify({ ok: false, error: `写入失败：${relPath}` });
      }

      const entry = noteStore.stat(root, relPath);
      log.info(`[save_note] 已保存笔记: ${relPath}`);

      // 通知界面刷新 —— 否则笔记页要等重新挂载才看得到新文件
      const { broadcastNotesChanged } = await import('../../../handlers/fileHandlers');
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