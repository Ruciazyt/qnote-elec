import { tool } from "./tool";
import { z } from 'zod';
import { getToolContext } from "../toolContext";

export const getClipboardHistoryTool = tool(
  async (input: { limit?: number; type?: 'text' | 'image' }) => {
    const { DB } = getToolContext();
    const { limit = 10, type } = input;

    const q = DB('note')
      .select('id', 'content', 'type', 'created_at', 'ocr_result')
      .orderBy('created_at', 'desc')
      .limit(limit);

    const rows = type ? await q.where('type', type) : await q;

    const items = rows.map((r: any) => {
      const isImage = r.type === 'image';
      if (!isImage) {
        return {
          id: r.id,
          type: r.type || 'text',
          content: r.content,
          created_at: r.created_at,
        };
      }
      if (r.ocr_result) {
        return {
          id: r.id,
          type: 'image',
          content: r.ocr_result,
          created_at: r.created_at,
        };
      }
      return {
        id: r.id,
        type: 'image',
        content: '[图片剪贴板，未做 OCR 识别，不返回原始图片数据]',
        image_bytes: typeof r.content === 'string' ? r.content.length : 0,
        created_at: r.created_at,
      };
    });

    return JSON.stringify({
      count: items.length,
      items,
    });
  },
  {
    name: 'get_clipboard_history',
    description:
      '获取用户最近的剪贴板记录（按时间倒序）。用户问"我刚才复制了什么"、"我上一条剪贴板"时使用。',
    schema: z.object({
      limit: z.number().int().min(1).max(50).optional().describe('返回条数，1-50，默认 10'),
      type: z.enum(['text', 'image']).optional().describe('可选：只取文本或图片'),
    }),
  }
);