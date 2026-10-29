/**
 * get_todos — 列出用户的 Todo
 *
 * 用途：用户问"我还有哪些 todo 没完成"，AI 调用此工具
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getToolContext } from './types';

export const getTodosTool = tool(
  async (input: {
    status?: 'all' | 'pending' | 'completed';
    priority?: 'high' | 'medium' | 'low';
    limit?: number;
  }) => {
    const { DB } = getToolContext();
    const { status = 'all', priority, limit = 20 } = input;

    let q = DB('todo').select('id', 'title', 'notes', 'priority', 'completed', 'due_date', 'created_at');
    if (status === 'pending') q = q.where('completed', false);
    if (status === 'completed') q = q.where('completed', true);
    if (priority) q = q.where('priority', priority);

    const rows = await q.orderBy('created_at', 'desc').limit(limit);

    return JSON.stringify({
      count: rows.length,
      items: rows,
    });
  },
  {
    name: 'get_todos',
    description:
      '获取用户的 Todo 列表。可按状态（已完成/未完成）和优先级过滤。用户问"我还有什么 todo"、"最近的任务"时使用。',
    schema: z.object({
      status: z.enum(['all', 'pending', 'completed']).optional().describe('过滤状态，默认 all'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('过滤优先级'),
      limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
    }),
  }
);