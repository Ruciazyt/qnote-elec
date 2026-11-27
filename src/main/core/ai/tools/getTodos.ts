import { tool } from "./tool";
import { z } from 'zod';
import { getToolContext } from "../toolContext";
import { formatLocalDateTime } from "../../../../shared/todo/reminderTime";

export const getTodosTool = tool(
  async (input: {
    status?: 'all' | 'pending' | 'completed' | 'archived';
    priority?: 'high' | 'medium' | 'low';
    limit?: number;
  }) => {
    const { DB } = getToolContext();
    const { status = 'all', priority, limit = 20 } = input;

    let q = DB('todo').select('id', 'title', 'notes', 'priority', 'completed', 'due_date', 'remind_at', 'created_at', 'archived_at');
    if (status === 'archived') {
      q = q.whereNotNull('archived_at');
    } else {
      q = q.whereNull('archived_at');
      if (status === 'pending') q = q.where('completed', false);
      if (status === 'completed') q = q.where('completed', true);
    }
    if (priority) q = q.where('priority', priority);

    const rows = await q.orderBy('created_at', 'desc').limit(limit);

    const items = rows.map((row: any) => ({
      ...row,
      remind_at: row.remind_at ? formatLocalDateTime(new Date(row.remind_at)) : null,
    }));

    return JSON.stringify({
      count: items.length,
      items,
    });
  },
  {
    name: 'get_todos',
    description:
      '获取用户的 Todo 列表。可按状态（未完成/已完成/归档）和优先级过滤。默认只返回未归档的任务；用户问"我还有什么 todo"、"最近的任务"时使用。' +
      '返回结果里带 remind_at（提醒时间戳），改提醒时间时先读它确认当前设的是什么。',
    schema: z.object({
      status: z.enum(['all', 'pending', 'completed', 'archived']).optional().describe('过滤状态，默认 all（不含归档项）'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('过滤优先级'),
      limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
    }),
  }
);