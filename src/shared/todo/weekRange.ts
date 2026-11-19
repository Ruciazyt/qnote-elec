export interface WeekRange {
  start: Date;
  end: Date;
}

export type TodoTimeValue = string | number | Date | null | undefined;

export interface WeekTodoLike {
  created_at: string | number;
  completed_at: string | number | null;
}

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const EPOCH_MILLIS = /^\d{12,}$/;

export function parseTodoTime(value: TodoTimeValue): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (EPOCH_MILLIS.test(trimmed)) {
    const fromEpoch = new Date(Number(trimmed));
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  const normalized = SQLITE_DATETIME.test(trimmed)
    ? trimmed.replace(" ", "T") + "Z"
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getWeekRange(now: Date = new Date()): WeekRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function isInWeek(
  value: TodoTimeValue,
  range: WeekRange
): boolean {
  const at = parseTodoTime(value);
  if (!at) return false;
  const time = at.getTime();
  return time >= range.start.getTime() && time <= range.end.getTime();
}

export function isInCurrentWeek(
  value: TodoTimeValue,
  now: Date = new Date()
): boolean {
  return isInWeek(value, getWeekRange(now));
}

export function isTodoInWeek(todo: WeekTodoLike, range: WeekRange): boolean {
  return isInWeek(todo.completed_at, range) || isInWeek(todo.created_at, range);
}
