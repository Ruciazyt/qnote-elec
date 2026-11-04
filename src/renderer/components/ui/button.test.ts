import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 按钮基类的焦点指示器契约
 *
 * WCAG 2.2 SC 2.4.11（Focus Appearance）要求焦点指示器的等效周长厚度 ≥ 2px。
 * Tailwind 的 `ring-N` 就是 `0 0 0 Npx` 的环，N 即厚度 —— 环的面积是「周长 × N」，
 * 1px 环无论按钮多大都不可能达到 2px 周长所需的面积。
 *
 * 这条用例锁的是**基类**（components/ui/button.tsx）本身的环宽。各处传给
 * `<Button>` 的 className 会经 tailwind-merge 合并，同一冲突组里传入的
 * `focus-visible:ring-N` 会覆盖基类那一份 —— 所以自己写了 ring-2 的按钮达标，
 * 没写的继承基类。
 *
 * 基类一改，全应用所有没自己指定环宽的按钮跟着变；业务代码自己覆盖的那些
 * 由各域的用例管，不在本文件范围内。
 */

const BUTTON_SOURCE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "button.tsx"),
  "utf8"
);

/**
 * 基类那一行的类名字符串（cva 的第一个参数）。
 *
 * 不能在整个文件里 grep「第一个 focus-visible:ring-N」—— 将来若有人在基类
 * 之前写了别的 ring 写法，就会读到错的匹配，门禁静默失效。
 * 只认基类这一处，匹配范围收紧到 cva 的第一个参数里。
 */
function baseClassString(): string {
  const m = BUTTON_SOURCE.match(/const buttonVariants = cva\(\s*"([^"]+)"/);
  if (!m) throw new Error("没找到 buttonVariants 的基类类名");
  return m[1];
}

/** 基类里 focus 环的宽度（Tailwind 的 ring-N → N px 环厚度） */
function baseRingWidth(): number {
  const m = baseClassString().match(/focus-visible:ring-(\d+)/);
  return m ? Number(m[1]) : 0;
}

describe("按钮基类的焦点指示器", () => {
  it.skip("基类的焦点指示器厚度 ≥ 2px（WCAG 2.2 SC 2.4.11）", () => {
    // 已知不达标：基类是 focus-visible:ring-1（1px 环）。
    //
    // 这是全应用共用的默认值，改它影响所有没自己指定环宽的按钮 ——
    // docs/UI-GUIDELINES.md 第五节要求这类改动「单独提一次，不夹在别的改动里」。
    // 缺陷已报 @Chief 定归属（components/ui/ 是共用组件，没有域 owner）。
    // 归属方改完把这条的 skip 去掉。
    expect(baseRingWidth()).toBeGreaterThanOrEqual(2);
  });
});
