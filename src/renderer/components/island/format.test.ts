import { describe, it, expect } from "vitest";
import { relativeTime, elapsedDuration, dueDateLabel } from "./format";

/**
 * 岛上的时间格式化
 *
 * 这些函数直接决定岛上那行摘要长什么样 —— 写错了用户看到的是
 * 「3 小时前」写成「3 小時前」或者「昨天」写成「1 天前」这种别扭文案。
 */
describe("relativeTime", () => {
  const now = Date.now();

  it("一分钟内显示「刚刚」", () => {
    expect(relativeTime(now)).toBe("刚刚");
    expect(relativeTime(now - 30_000)).toBe("刚刚");
  });

  it("分钟 / 小时 / 天逐级切换", () => {
    expect(relativeTime(now - 3 * 60_000)).toBe("3 分钟前");
    expect(relativeTime(now - 2 * 3_600_000)).toBe("2 小时前");
    expect(relativeTime(now - 26 * 3_600_000)).toBe("昨天");
  });

  it("超过一天只给日期，不再数天数", () => {
    const threeDaysAgo = now - 3 * 86_400_000;
    const label = relativeTime(threeDaysAgo);
    expect(label).toMatch(/^\d{2}-\d{2}$/);
  });

  it("空时间戳返回空串（而不是「NaN 天前」）", () => {
    expect(relativeTime(0)).toBe("");
  });

  it("未来时间也显示「刚刚」——设备时间跳变时不至于出现负数", () => {
    expect(relativeTime(now + 60_000)).toBe("刚刚");
  });
});

describe("elapsedDuration", () => {
  it("不到一分钟只报秒", () => {
    expect(elapsedDuration(5_000)).toBe("5 秒");
  });

  it("超过一分钟报分秒", () => {
    expect(elapsedDuration(80_000)).toBe("1 分 20 秒");
  });

  it("负数按 0 处理，不出现负秒", () => {
    expect(elapsedDuration(-1000)).toBe("0 秒");
  });
});

describe("dueDateLabel", () => {
  it("今天 / 明天 / 昨天按自然日算，不受时分影响", () => {
    const today = new Date();
    today.setHours(23, 30, 0, 0);
    expect(dueDateLabel(today.toISOString())).toBe("今天");

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(dueDateLabel(tomorrow.toISOString())).toBe("明天");

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(dueDateLabel(yesterday.toISOString())).toBe("昨天");
  });

  it("非法日期返回空串", () => {
    expect(dueDateLabel("not-a-date")).toBe("");
  });
});
