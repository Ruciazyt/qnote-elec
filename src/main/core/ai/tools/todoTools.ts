import { tool } from "./tool";
import { z } from 'zod';
import { getToolContext } from "../toolContext";
import { formatLocalDateTime } from "../../../../shared/todo/reminderTime";
import { formatReminderLabel, resolveReminderTime } from "../../todo/nativeTodo";
import { log } from "../../system/log";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateString(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

function resolveDueDate(
  value: string | null | undefined
): { date: string | null; error?: string } {
  const text = (value ?? "").trim();
  if (!text) return { date: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { date: text };
  const resolved = resolveReminderTime(text);
  if (!resolved.ok || !resolved.at) {
    return { date: null, error: resolved.error ?? `无法识别截止时间「${text}」` };
  }
  return { date: toDateString(resolved.at) };
}

function resolveRemindAt(
  value: string | null | undefined
): { at: Date | null; error?: string } {
  const text = (value ?? "").trim();
  if (!text) return { at: null };
  const resolved = resolveReminderTime(text);
  if (!resolved.ok || !resolved.at) {
    return { at: null, error: resolved.error ?? `无法识别提醒时间「${text}」` };
  }
  return { at: resolved.at };
}

async function notifyTodosChanged(): Promise<void> {
  try {
    const { broadcastTodosChanged } = await import(
      "../../../handlers/todo/todoHandlers"
    );
    broadcastTodosChanged();
  } catch (err) {
    log.warn("[create_todo] 广播 Todo 变更失败", err);
  }
}

export const createTodoTool = tool(
  async (input: {
    title: string;
    notes?: string;
    priority?: 'high' | 'medium' | 'low';
    due_date?: string | null;
    remind_at?: string | null;
  }) => {
    const ctx = getToolContext();
    const title = (input.title ?? "").trim();
    if (!title) {
      return JSON.stringify({ ok: false, error: "Todo 需要标题。" });
    }

    const due = resolveDueDate(input.due_date);
    if (due.error) {
      return JSON.stringify({ ok: false, error: due.error });
    }

    const remind = resolveRemindAt(input.remind_at);
    if (remind.error) {
      return JSON.stringify({ ok: false, error: remind.error });
    }

    const now = new Date();
    try {
      const [row] = await ctx.DB.from("todo")
        .insert({
          title,
          notes: input.notes?.trim() || null,
          priority: input.priority ?? "medium",
          due_date: due.date,
          remind_at: remind.at,
          completed: 0,
          completed_at: null,
          archived_at: null,
          reminded_at: null,
          created_at: now,
          updated_at: now,
          attachments: "[]",
        })
        .returning("*");

      await notifyTodosChanged();

      return JSON.stringify({
        ok: true,
        id: row.id,
        title: row.title,
        due_date: row.due_date ?? null,
        remind_at: row.remind_at ? formatLocalDateTime(new Date(row.remind_at)) : null,
        reminder_label: remind.at ? formatReminderLabel(remind.at) : null,
        message: remind.at
          ? `已创建 Todo「${title}」，将在 ${formatReminderLabel(remind.at)} 提醒你。`
          : `已创建 Todo「${title}」。`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error("[create_todo] 创建 Todo 失败", err);
      return JSON.stringify({ ok: false, error: `创建 Todo 失败：${reason}` });
    }
  },
  {
    name: 'create_todo',
    description:
      '创建一条待办任务。用户说"帮我记个 todo""提醒我明天三点开会""加个待办"时使用。' +
      'remind_at 可以直接写自然语言时间："明天下午3点""30分钟后""今晚8点""2026-11-19 15:30""下周一上午10点"，' +
      '工具会自己换算成具体时刻；到点会弹系统通知。' +
      'due_date 是截止日期（只到天），可以写"明天""周五"。' +
      '用户没说具体时间就不要瞎设提醒。',
    schema: z.object({
      title: z.string().describe('待办标题，一句话说清要做什么'),
      notes: z
        .string()
        .optional()
        .describe('补充说明，可选'),
      priority: z
        .enum(['high', 'medium', 'low'])
        .optional()
        .describe('优先级，默认 medium'),
      due_date: z
        .string()
        .optional()
        .describe('截止日期，可写"明天""周五"或 2026-11-19 这样的具体日期'),
      remind_at: z
        .string()
        .optional()
        .describe(
          '提醒时间，自然语言即可："明天下午3点""30分钟后""今晚8点""2026-11-19 15:30"。不填则不提醒'
        ),
    }),
  }
);

export const updateTodoTool = tool(
  async (input: {
    id?: number;
    title?: string;
    new_title?: string;
    notes?: string | null;
    priority?: 'high' | 'medium' | 'low';
    due_date?: string | null;
    remind_at?: string | null;
    completed?: boolean;
  }) => {
    const ctx = getToolContext();

    let target: any = null;
    if (typeof input.id === "number") {
      target = await ctx.DB.from("todo").where("id", input.id).first();
    } else if (input.title && input.title.trim()) {
      const rows = await ctx.DB.from("todo")
        .where("title", input.title.trim())
        .whereNull("archived_at")
        .orderBy("created_at", "desc");
      target = rows[0] ?? null;
    }

    if (!target) {
      return JSON.stringify({
        ok: false,
        error: "没找到要修改的 Todo：请先 get_todos 查看 id，或给出准确的标题。",
      });
    }

    const update: Record<string, unknown> = { updated_at: new Date() };
    if (input.new_title !== undefined) {
      const nextTitle = input.new_title.trim();
      if (!nextTitle) {
        return JSON.stringify({ ok: false, error: "新标题不能为空。" });
      }
      update.title = nextTitle;
    } else if (input.title !== undefined && typeof input.id === "number") {
      update.title = input.title.trim();
    }
    if (input.notes !== undefined) update.notes = input.notes?.trim() || null;
    if (input.priority !== undefined) update.priority = input.priority;
    if (input.due_date !== undefined) {
      const due = resolveDueDate(input.due_date);
      if (due.error) return JSON.stringify({ ok: false, error: due.error });
      update.due_date = due.date;
    }
    if (input.remind_at !== undefined) {
      const remind = resolveRemindAt(input.remind_at);
      if (remind.error) return JSON.stringify({ ok: false, error: remind.error });
      update.remind_at = remind.at;
      update.reminded_at = null;
    }
    if (input.completed !== undefined) {
      update.completed = input.completed ? 1 : 0;
      update.completed_at = input.completed ? new Date() : null;
    }

    try {
      const [row] = await ctx.DB.from("todo")
        .where("id", target.id)
        .update(update)
        .returning("*");

      await notifyTodosChanged();

      const remindAt = row.remind_at ? new Date(row.remind_at) : null;
      return JSON.stringify({
        ok: true,
        id: row.id,
        title: row.title,
        completed: row.completed ? 1 : 0,
        due_date: row.due_date ?? null,
        remind_at: remindAt ? formatLocalDateTime(remindAt) : null,
        reminder_label: remindAt ? formatReminderLabel(remindAt) : null,
        message: remindAt
          ? `已更新 Todo「${row.title}」，提醒时间 ${formatReminderLabel(remindAt)}。`
          : `已更新 Todo「${row.title}」。`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.error("[update_todo] 更新 Todo 失败", err);
      return JSON.stringify({ ok: false, error: `更新 Todo 失败：${reason}` });
    }
  },
  {
    name: 'update_todo',
    description:
      '修改已有的待办任务：改标题、改优先级、改截止日期、改提醒时间、标记完成。' +
      '用户说"把那个 todo 改到明天下午三点""提醒我改成明天""这个完成了"时使用。' +
      '用 id 精确定位（先 get_todos 拿 id）；只有标题时按标题匹配最近的一条。' +
      '要改标题请用 new_title：title 只用来定位，改名同时改标题会写回同一个值。' +
      'remind_at 同样接受自然语言时间："明天下午3点""30分钟后""今晚8点"；传 null 或空字符串取消提醒。',
    schema: z.object({
      id: z.number().int().optional().describe('要修改的 Todo 的 id，来自 get_todos'),
      title: z.string().optional().describe('用来定位任务的标题（不会改标题）'),
      new_title: z.string().optional().describe('新的标题；要改名用这个字段'),
      notes: z.string().nullable().optional().describe('新的备注，传 null 清空'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('新的优先级'),
      due_date: z
        .string()
        .nullable()
        .optional()
        .describe('新的截止日期，"明天""周五"或 2026-11-19；传 null 清空'),
      remind_at: z
        .string()
        .nullable()
        .optional()
        .describe('新的提醒时间，"明天下午3点""30分钟后""今晚8点"；传 null 或空字符串取消提醒'),
      completed: z.boolean().optional().describe('true 标记完成，false 标记未完成'),
    }),
  }
);
