import { describe, expect, it } from "vitest";
import {
  formatReminderLabel,
  fromDateTimeLocalValue,
  resolveReminderTime,
  toDateTimeLocalValue,
} from "./reminderTime";

const NOW = new Date(2026, 10, 18, 14, 30, 0);

function resolve(text: string, now: Date = NOW): Date {
  const result = resolveReminderTime(text, now);
  if (!result.ok || !result.at) {
    throw new Error(`解析失败: ${result.error ?? "未知错误"}`);
  }
  return result.at;
}

function mondayOfThisWeek(now: Date = NOW): Date {
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (1 - dow));
}

describe("resolveReminderTime", () => {
  it("解析中文相对日期与时段", () => {
    expect(resolve("明天下午3点")).toEqual(new Date(2026, 10, 19, 15, 0));
    expect(resolve("明天上午9点")).toEqual(new Date(2026, 10, 19, 9, 0));
    expect(resolve("后天晚上8点")).toEqual(new Date(2026, 10, 20, 20, 0));
    expect(resolve("今天晚上8点半")).toEqual(new Date(2026, 10, 18, 20, 30));
    expect(resolve("明晚9点")).toEqual(new Date(2026, 10, 19, 21, 0));
  });

  it("解析中文钟点写法", () => {
    expect(resolve("明天下午3点15分")).toEqual(new Date(2026, 10, 19, 15, 15));
    expect(resolve("明天15:30")).toEqual(new Date(2026, 10, 19, 15, 30));
    expect(resolve("明天下午三点")).toEqual(new Date(2026, 10, 19, 15, 0));
  });

  it("解析时长", () => {
    expect(resolve("30分钟后")).toEqual(new Date(2026, 10, 18, 15, 0));
    expect(resolve("2小时后")).toEqual(new Date(2026, 10, 18, 16, 30));
    expect(resolve("半小时后")).toEqual(new Date(2026, 10, 18, 15, 0));
    expect(resolve("3天后")).toEqual(new Date(2026, 10, 21, 14, 30));
    expect(resolve("in 30 minutes")).toEqual(new Date(2026, 10, 18, 15, 0));
    expect(resolve("in 2 hours")).toEqual(new Date(2026, 10, 18, 16, 30));
  });

  it("解析绝对时间", () => {
    expect(resolve("2026-11-19 15:30")).toEqual(new Date(2026, 10, 19, 15, 30));
    expect(resolve("2026-11-19T15:30:00")).toEqual(new Date(2026, 10, 19, 15, 30));
    expect(resolve("2026年11月19日 15:30")).toEqual(new Date(2026, 10, 19, 15, 30));
    expect(resolve("2026-11-19")).toEqual(new Date(2026, 10, 19, 9, 0));
  });

  it("解析星期", () => {
    const nextMonday = new Date(mondayOfThisWeek().getTime() + 7 * 86400000);
    expect(resolve("下周一")).toEqual(
      new Date(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate(), 9, 0)
    );
    expect(resolve("下周一上午10点")).toEqual(
      new Date(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate(), 10, 0)
    );
  });

  it("星期几后面的上下午要算进小时", () => {
    const nextMonday = new Date(mondayOfThisWeek().getTime() + 7 * 86400000);
    const day = new Date(
      nextMonday.getFullYear(),
      nextMonday.getMonth(),
      nextMonday.getDate(),
      14,
      0
    );
    expect(resolve("下周一下午2点")).toEqual(day);
    expect(resolve("下周一晚上8点")).toEqual(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), 20, 0)
    );
    expect(resolve("下周一上午10点").getHours()).toBe(10);
    expect(resolve("下周一中午12点").getHours()).toBe(12);
    expect(resolve("下周一凌晨3点").getHours()).toBe(3);
  });

  it("解析英文相对表述", () => {
    expect(resolve("tomorrow 3pm")).toEqual(new Date(2026, 10, 19, 15, 0));
    expect(resolve("tomorrow morning")).toEqual(new Date(2026, 10, 19, 9, 0));
    expect(resolve("tonight 8pm")).toEqual(new Date(2026, 10, 18, 20, 0));
  });

  it("裸钟点若已过则按下午理解", () => {
    expect(resolve("3点")).toEqual(new Date(2026, 10, 18, 15, 0));
    expect(resolve("16点")).toEqual(new Date(2026, 10, 18, 16, 0));
  });

  it("无法识别时给出错误", () => {
    const empty = resolveReminderTime("", NOW);
    expect(empty.ok).toBe(false);

    const garbage = resolveReminderTime("随便什么时候都行", NOW);
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.error).toContain("无法识别");
  });
});

describe("formatReminderLabel", () => {
  it("按相对天数给出标签", () => {
    expect(formatReminderLabel(new Date(2026, 10, 18, 20, 30), NOW)).toBe("今天 20:30");
    expect(formatReminderLabel(new Date(2026, 10, 19, 9, 5), NOW)).toBe("明天 09:05");
    expect(formatReminderLabel(new Date(2026, 10, 22, 9, 0), NOW)).toBe("4 天后 09:00");
    expect(formatReminderLabel(new Date(2026, 11, 3, 9, 0), NOW)).toBe("12月3日 09:00");
  });
});

describe("datetime-local 互转", () => {
  it("本地时间字符串往返一致", () => {
    const value = toDateTimeLocalValue(new Date(2026, 10, 19, 15, 30));
    expect(value).toBe("2026-11-19T15:30");
    expect(fromDateTimeLocalValue(value)).toEqual(new Date(2026, 10, 19, 15, 30));
  });

  it("空值返回 null", () => {
    expect(toDateTimeLocalValue(null)).toBe("");
    expect(fromDateTimeLocalValue("")).toBeNull();
  });
});
