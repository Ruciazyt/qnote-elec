import {
  formatReminderLabel as tsFormatReminderLabel,
  resolveReminderTime as tsResolveReminderTime,
} from "../../../shared/todo/reminderTime";
import type { ReminderTimeResolution } from "../../../shared/todo/reminderTime";
import {
  isExpiredReminder as tsIsExpiredReminder,
  pickDueReminders as tsPickDueReminders,
} from "../../../shared/todo/reminderDue";
import type { ReminderCandidate } from "../../../shared/todo/reminderDue";
import { nativeCall } from "../system/nativeModules";

interface NativeTodo {
  pickDueReminders(rows: ReminderCandidate[], now: Date, graceMs: number): ReminderCandidate[];
  isExpiredReminder(row: ReminderCandidate, now: Date, graceMs: number): boolean;
  resolveReminderTime(input: string, now: Date): ReminderTimeResolution;
  formatReminderLabel(at: Date, now: Date): string;
}

const WRAPPER = "todo-rs.cjs";

export function pickDueReminders(
  rows: ReminderCandidate[],
  now: Date,
  graceMs: number
): ReminderCandidate[] {
  return nativeCall<ReminderCandidate[], NativeTodo>(
    WRAPPER,
    "pickDueReminders",
    () => tsPickDueReminders(rows, now, graceMs),
    (module) => module.pickDueReminders(rows, now, graceMs)
  );
}

export function isExpiredReminder(
  row: ReminderCandidate,
  now: Date,
  graceMs: number
): boolean {
  return nativeCall<boolean, NativeTodo>(
    WRAPPER,
    "isExpiredReminder",
    () => tsIsExpiredReminder(row, now, graceMs),
    (module) => module.isExpiredReminder(row, now, graceMs)
  );
}

export function resolveReminderTime(
  input: string,
  now: Date = new Date()
): ReminderTimeResolution {
  return nativeCall<ReminderTimeResolution, NativeTodo>(
    WRAPPER,
    "resolveReminderTime",
    () => tsResolveReminderTime(input, now),
    (module) => module.resolveReminderTime(input, now)
  );
}

export function formatReminderLabel(at: Date, now: Date = new Date()): string {
  return nativeCall<string, NativeTodo>(
    WRAPPER,
    "formatReminderLabel",
    () => tsFormatReminderLabel(at, now),
    (module) => module.formatReminderLabel(at, now)
  );
}
