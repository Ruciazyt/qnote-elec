import { BrowserWindow, Notification } from "electron";
import type { Knex } from "knex";
import {
  isExpiredReminder,
  pickDueReminders,
  type ReminderCandidate,
} from "../../../shared/todo/reminderDue";
import { log } from "../system/log";
import { showMainWindow } from "../window/mainWindow";

const POLL_INTERVAL_MS = 30_000;
const GRACE_MS = 24 * 60 * 60 * 1000;

export interface TodoReminderPayload {
  id: number;
  title: string;
  notes: string | null;
  priority: string;
  remind_at: string;
}

export type { ReminderCandidate };

const PRIORITY_LABEL: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

function sendReminderToWindows(payload: TodoReminderPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send("todo:reminder", payload);
    } catch (err) {
      log.warn("[todo-reminder] 推送提醒到渲染层失败", err);
    }
  }
}

function notifyReminder(row: ReminderCandidate): void {
  const payload: TodoReminderPayload = {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    priority: row.priority,
    remind_at: row.remind_at ?? "",
  };

  sendReminderToWindows(payload);

  if (!Notification.isSupported()) {
    log.info("[todo-reminder] 当前系统不支持原生通知，仅在应用内提示");
    return;
  }

  try {
    const notification = new Notification({
      title: `Todo 提醒 · ${row.title}`,
      body: row.notes?.trim() || PRIORITY_LABEL[row.priority] || "该处理这件事了",
    });
    notification.on("click", () => {
      showMainWindow();
      sendReminderToWindows(payload);
    });
    notification.show();
  } catch (err) {
    log.error("[todo-reminder] 弹出原生通知失败", err);
  }
}

export async function checkDueReminders(DB: Knex): Promise<number> {
  try {
    const rows = (await DB.from("todo")
      .select("id", "title", "notes", "priority", "remind_at")
      .whereNotNull("remind_at")
      .whereNull("reminded_at")
      .whereNull("archived_at")
      .where("completed", false)) as ReminderCandidate[];

    if (!rows || rows.length === 0) return 0;

    const now = new Date();
    const due = pickDueReminders(rows, now, GRACE_MS);
    const expired = rows.filter((row) => isExpiredReminder(row, now, GRACE_MS));

    for (const row of expired) {
      await DB.from("todo").where("id", row.id).update({ reminded_at: now });
    }

    for (const row of due) {
      await DB.from("todo")
        .where("id", row.id)
        .update({ reminded_at: now, updated_at: now });
      notifyReminder(row);
    }

    if (due.length > 0) {
      log.info(`[todo-reminder] 触发 ${due.length} 条到期提醒`);
      const { broadcastTodosChanged } = await import(
        "../../handlers/todo/todoHandlers"
      );
      broadcastTodosChanged();
    }

    return due.length;
  } catch (err) {
    log.error("[todo-reminder] 检查到期提醒失败", err);
    return 0;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startReminderScheduler(DB: Knex): void {
  if (timer) return;
  const tick = () => {
    void checkDueReminders(DB);
  };
  void checkDueReminders(DB);
  timer = setInterval(tick, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  log.info(`[todo-reminder] 提醒调度器已启动，轮询间隔 ${POLL_INTERVAL_MS / 1000} 秒`);
}

export function stopReminderScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  log.info("[todo-reminder] 提醒调度器已停止");
}
