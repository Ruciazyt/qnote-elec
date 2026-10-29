/**
 * AI 长期记忆工具组 —— remember / recall / forget
 *
 * 让 AI 自主决定什么值得长期保留，存到 <userData>/ai-memory.json，
 * 并在后续对话中自动召回。存储实现见 ../memory/longTermMemory.ts。
 *
 * 为什么这组工具和 note_* 工具是两回事：
 *   note_*  面向「用户要一份文件」—— 显式产物，用户看得见、能编辑
 *   memory* 面向「AI 需要跨会话记住」—— 内部状态，用户一般不关心
 * 混用会让笔记列表被内部数据污染，也会让「记住我的偏好」变成「生成一篇笔记」。
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { longTermMemory, MemoryKind } from '../memory/longTermMemory';
import { log } from '../../log';

/** 类别 → 中文标签，用于回给模型的措辞 */
const KIND_LABEL: Record<MemoryKind, string> = {
  preference: '偏好',
  fact: '事实',
  convention: '约定',
  goal: '目标',
};

/**
 * remember — 写入一条长期记忆
 *
 * 提示词里约束了「只记稳定信息」，但工具侧仍要做防御：
 * 模型偶尔会过度热情，把一次性内容也记下来。
 */
export const rememberTool = tool(
  async (input: { content: string; kind?: 'preference' | 'fact' | 'convention' | 'goal' }) => {
    try {
      const kind: MemoryKind = input.kind ?? 'fact';
      const { item, created } = longTermMemory.remember({
        kind,
        content: input.content,
      });

      return JSON.stringify({
        ok: true,
        created,
        id: item.id,
        kind: item.kind,
        content: item.content,
        message: created
          ? `已记住（${KIND_LABEL[kind]}）：${item.content}`
          : `这条已经记过了，刷新了时间（${KIND_LABEL[kind]}）：${item.content}`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error('[remember] 写入失败', err);
      return JSON.stringify({ ok: false, error: `写入记忆失败：${reason}` });
    }
  },
  {
    name: 'remember',
    description:
      '把一条值得长期保留的信息存入记忆，之后的对话会自动带上它。' +
      '只记稳定且反复出现的信息：用户偏好、长期事实、协作约定、进行中的目标。' +
      '不要记一次性的内容、当轮的临时信息、或者密码 / 证件号 / 联系方式这类敏感信息。',
    schema: z.object({
      content: z.string().describe('一句话描述这条记忆。要具体可执行，例：「用户偏好中文回复」'),
      kind: z
        .enum(['preference', 'fact', 'convention', 'goal'])
        .optional()
        .describe(
          '类别：preference 偏好 / fact 稳定事实 / convention 协作约定 / goal 长期目标。默认 fact'
        ),
    }),
  }
);

/**
 * recall — 主动查一下自己记住了什么
 *
 * 正常情况下记忆会自动注入 prompt，不需要主动调。
 * 但用户直接问「你记得我什么」时，这个工具让 AI 能如实回答而不是靠猜。
 */
export const recallTool = tool(
  async (input: { kind?: 'preference' | 'fact' | 'convention' | 'goal'; limit?: number }) => {
    try {
      const all = longTermMemory.list(input.kind);
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
      const items = all.slice(0, limit);
      return JSON.stringify({
        ok: true,
        total: all.length,
        count: items.length,
        items: items.map((x) => ({
          id: x.id,
          kind: x.kind,
          kindLabel: KIND_LABEL[x.kind],
          content: x.content,
          createdAt: x.createdAt,
          hitCount: x.hitCount,
        })),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: `读取记忆失败：${reason}` });
    }
  },
  {
    name: 'recall',
    description:
      '查看自己长期记住了哪些信息。用户问「你记得我什么」「我的偏好你还记得吗」时使用。' +
      '正常对话中记忆会自动带入，不需要主动调用本工具。',
    schema: z.object({
      kind: z
        .enum(['preference', 'fact', 'convention', 'goal'])
        .optional()
        .describe('可选：只看某一类记忆'),
      limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
    }),
  }
);

/**
 * forget — 删除一条记忆
 *
 * 用户说「别记这个」「忘掉刚才那条」时使用。
 */
export const forgetTool = tool(
  async (input: { id?: string; contains?: string }) => {
    try {
      // 优先按 id 精确删；给了关键词则按内容匹配删
      if (input.id) {
        const ok = longTermMemory.forget(input.id);
        return JSON.stringify({
          ok,
          message: ok ? '已删除该条记忆。' : '没有找到 id 对应的记忆。',
        });
      }
      if (input.contains) {
        const all = longTermMemory.list();
        const needle = input.contains.toLowerCase();
        const hit = all.find((x) => x.content.toLowerCase().includes(needle));
        if (!hit) {
          return JSON.stringify({ ok: false, error: `没有包含「${input.contains}」的记忆。` });
        }
        const ok = longTermMemory.forget(hit.id);
        return JSON.stringify({ ok, deleted: hit.content, message: `已删除记忆：${hit.content}` });
      }
      return JSON.stringify({
        ok: false,
        error: '需要提供 id 或 contains 其中之一。',
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ ok: false, error: `删除失败：${reason}` });
    }
  },
  {
    name: 'forget',
    description: '删除一条长期记忆。用户要求忘掉某件事时使用。',
    schema: z.object({
      id: z.string().optional().describe('要删除的记忆 id（用 recall 拿到）'),
      contains: z.string().optional().describe('或直接给内容关键词，匹配到就删'),
    }),
  }
);

/**
 * 组装注入 prompt 的记忆文本
 *
 * 返回空串表示没有可用记忆 —— 调用方据此跳过记忆段，
 * 避免 prompt 里出现「记忆：」这种空壳标题。
 */
export function composeMemoryBlock(items: Array<{ kind: MemoryKind; content: string }>): string {
  if (items.length === 0) return '';
  const lines = items.map((x) => `- [${KIND_LABEL[x.kind]}] ${x.content}`);
  return [
    '## 你对用户的长期记忆',
    '',
    '以下是你此前记下的、关于这个用户的信息，回答时自然地遵循它们，不要逐条复述：',
    ...lines,
  ].join('\n');
}