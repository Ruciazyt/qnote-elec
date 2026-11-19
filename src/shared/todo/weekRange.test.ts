import { describe, expect, it } from "vitest";
import {
  getWeekRange,
  isInCurrentWeek,
  isTodoInWeek,
  parseTodoTime,
} from "./weekRange";

const WEDNESDAY = new Date(2026, 10, 18, 14, 30, 0);
const MONDAY_START = new Date(2026, 10, 16, 0, 0, 0);
const SUNDAY_END = new Date(2026, 10, 22, 23, 59, 59, 999);

describe("getWeekRange", () => {
  it("从周一 0 点算到周日结束", () => {
    const { start, end } = getWeekRange(WEDNESDAY);
    expect(start.getTime()).toBe(MONDAY_START.getTime());
    expect(end.getTime()).toBe(SUNDAY_END.getTime());
  });

  it("周日也还算本周", () => {
    const sunday = new Date(2026, 10, 22, 20, 0, 0);
    const { start } = getWeekRange(sunday);
    expect(start.getTime()).toBe(MONDAY_START.getTime());
  });
});

describe("parseTodoTime", () => {
  it("SQLite 的时间串按 UTC 解析", () => {
    const parsed = parseTodoTime("2026-11-18 06:30:00");
    expect(parsed?.toISOString()).toBe("2026-11-18T06:30:00.000Z");
  });

  it("数据库里的毫秒整数能解析", () => {
    const at = new Date(2026, 10, 18, 6, 30, 0);
    expect(parseTodoTime(at.getTime())?.toISOString()).toBe(at.toISOString());
    expect(parseTodoTime(String(at.getTime()))?.toISOString()).toBe(at.toISOString());
  });

  it("非法的数值返回 null", () => {
    expect(parseTodoTime(Number.NaN)).toBeNull();
    expect(parseTodoTime(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("ISO 时间与空值都能处理", () => {
    expect(parseTodoTime("2026-11-18T06:30:00.000Z")?.toISOString()).toBe(
      "2026-11-18T06:30:00.000Z"
    );
    expect(parseTodoTime(null)).toBeNull();
    expect(parseTodoTime("")).toBeNull();
    expect(parseTodoTime("not-a-date")).toBeNull();
  });
});

describe("isInCurrentWeek", () => {
  it("本周一 0 点算本周内", () => {
    expect(isInCurrentWeek(MONDAY_START.toISOString(), WEDNESDAY)).toBe(true);
  });

  it("本周日 23:59 算本周内", () => {
    expect(isInCurrentWeek(SUNDAY_END.toISOString(), WEDNESDAY)).toBe(true);
  });

  it("上周日 23:59 不算", () => {
    const lastSunday = new Date(2026, 10, 15, 23, 59, 59, 999);
    expect(isInCurrentWeek(lastSunday.toISOString(), WEDNESDAY)).toBe(false);
  });

  it("下周一 0 点不算", () => {
    const nextMonday = new Date(2026, 10, 23, 0, 0, 0);
    expect(isInCurrentWeek(nextMonday.toISOString(), WEDNESDAY)).toBe(false);
  });

  it("空值与非法值都不算", () => {
    expect(isInCurrentWeek(null, WEDNESDAY)).toBe(false);
    expect(isInCurrentWeek("not-a-date", WEDNESDAY)).toBe(false);
  });
});

describe("isTodoInWeek", () => {
  const range = getWeekRange(WEDNESDAY);

  it("完成时间落在本周就算", () => {
    const todo = {
      created_at: new Date(2026, 9, 1, 9, 0, 0).toISOString(),
      completed_at: new Date(2026, 10, 17, 15, 0, 0).toISOString(),
    };
    expect(isTodoInWeek(todo, range)).toBe(true);
  });

  it("创建时间落在本周就算", () => {
    const todo = {
      created_at: new Date(2026, 10, 18, 9, 0, 0).toISOString(),
      completed_at: null,
    };
    expect(isTodoInWeek(todo, range)).toBe(true);
  });

  it("两个时间都不在本周就不算", () => {
    const todo = {
      created_at: new Date(2026, 9, 1, 9, 0, 0).toISOString(),
      completed_at: new Date(2026, 9, 2, 9, 0, 0).toISOString(),
    };
    expect(isTodoInWeek(todo, range)).toBe(false);
  });

  it("毫秒整数格式的 todo 也能判定", () => {
    const todo = {
      created_at: new Date(2026, 10, 18, 9, 0, 0).getTime(),
      completed_at: null,
    };
    expect(isTodoInWeek(todo, range)).toBe(true);
  });

  it("未完成且创建于上周的不算", () => {
    const todo = {
      created_at: new Date(2026, 10, 10, 9, 0, 0).toISOString(),
      completed_at: null,
    };
    expect(isTodoInWeek(todo, range)).toBe(false);
  });
});
