export interface ReminderCandidate {
  id: number;
  title: string;
  notes: string | null;
  priority: string;
  remind_at: string | null;
}

export function pickDueReminders(
  rows: ReminderCandidate[],
  now: Date,
  graceMs: number
): ReminderCandidate[] {
  const nowMs = now.getTime();
  return rows.filter((row) => {
    if (!row.remind_at) return false;
    const at = new Date(row.remind_at).getTime();
    if (Number.isNaN(at)) return false;
    if (at > nowMs) return false;
    return nowMs - at <= graceMs;
  });
}

export function isExpiredReminder(
  row: ReminderCandidate,
  now: Date,
  graceMs: number
): boolean {
  if (!row.remind_at) return false;
  const at = new Date(row.remind_at).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at > graceMs;
}
