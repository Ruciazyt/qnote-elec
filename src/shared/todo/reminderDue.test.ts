import { describe, expect, it } from "vitest";
import { isExpiredReminder, pickDueReminders } from "./reminderDue";

const NOW = new Date(2026, 10, 18, 14, 30, 0);
const GRACE = 24 * 60 * 60 * 1000;

function row(id: number, remindAt: string | null): {
  id: number;
  title: string;
  notes: string | null;
  priority: string;
  remind_at: string | null;
} {
  return { id, title: `任务 ${id}`, notes: null, priority: "medium", remind_at: remindAt };
}

describe("pickDueReminders", () => {
  it("只挑已到点且未超时的", () => {
    const rows = [
      row(1, new Date(2026, 10, 18, 14, 0).toISOString()),
      row(2, new Date(2026, 10, 18, 15, 0).toISOString()),
      row(3, new Date(2026, 10, 18, 13, 0).toISOString()),
    ];
    const due = pickDueReminders(rows, NOW, GRACE);
    expect(due.map((r) => r.id)).toEqual([1, 3]);
  });

  it("忽略没有提醒时间与时间解析失败的", () => {
    const rows = [row(1, null), row(2, "not-a-date")];
    expect(pickDueReminders(rows, NOW, GRACE)).toEqual([]);
  });

  it("超出宽限期的算过期，不触发", () => {
    const tooOld = new Date(2026, 10, 16, 14, 30).toISOString();
    expect(pickDueReminders([row(1, tooOld)], NOW, GRACE)).toEqual([]);
    expect(isExpiredReminder(row(1, tooOld), NOW, GRACE)).toBe(true);
  });

  it("还没到点的不算过期", () => {
    const future = new Date(2026, 10, 19, 9, 0).toISOString();
    expect(pickDueReminders([row(1, future)], NOW, GRACE)).toEqual([]);
    expect(isExpiredReminder(row(1, future), NOW, GRACE)).toBe(false);
  });
});
