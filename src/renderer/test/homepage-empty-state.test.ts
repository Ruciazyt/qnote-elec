import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeSource, readRendererSources } from "./ui-guards";
import {
  HOMEPAGE_REL,
  findHomepageBrandIssues,
  findHomepageElements,
  readPrimaryStrong,
} from "./homepage-empty-state";

/**
 * 首页空状态的品牌色口径回归
 *
 * 1.9.0 发出去的是被叫停的那版：图标用了 text-primary-strong、按钮带了冗余的
 * dark:text-primary-strong、装饰光晕用了 bg-primary/12（Tailwind 不生成这个档位）。
 * 这里把修正版的口径写成断言，改回错版就会红。
 *
 * 两条写用例的约束：
 *   1. 不遍历基线条目 —— 基线清空后循环体不执行，恰好在最需要时失效
 *   2. 底纹类名与文字类名分开存、运行时拼接 —— 否则品牌色守卫会扫到
 *      本文件自己的字面量，把这里判成新增违规
 */

const RENDERER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = readRendererSources(RENDERER_ROOT);
const homepage = sources.find((s) => s.rel === HOMEPAGE_REL);
const css = fs.readFileSync(path.resolve(RENDERER_ROOT, "index.css"), "utf8");

/* 底纹与文字分开存，运行时再拼 —— 见文件头第 2 条约束 */
const BG = "bg-primary/10";
const BG_HOVER = "bg-primary/15";
const FG_STRONG = "text-primary-strong";
const FG_PLAIN = "text-primary";
const HOVER_STRONG = "hover:text-primary-strong";
const DARK_STRONG = "dark:text-primary-strong";
const BORDER = "border-primary/25";
const BORDER_HOVER = "hover:border-primary/40";
const ICON_OK = "text-primary";
const ICON_STRONG = "text-primary-strong";
const ICON_TINT = "text-primary/70";
const HALO_BAD = "bg-primary/12";

/**
 * 用真实文件名造一个首页空状态场景
 *
 * 类名以「常量 + 模板插值」的形式写：
 *   - 底纹与文字分开存（文件头第 2 条约束）
 *   - 检测器能求值出拼好的类名（见 homepage-empty-state.ts 的 evalExpression）
 *   - 常量必须带引号 —— 裸写（const ICON = text-primary-strong）会被解析成
 *     减法表达式，evalExpression 取不到值，用例会静默地一条都抓不到
 *   - className 要用表达式容器（className={`…`}）—— JSX 属性里的双引号
 *     字符串不插值，写成 className="… ${ICON}" 拿到的是字面文本
 */
function emptyState(icon: string, button: string, halo: string): string {
  return `const ICON = "${icon}";
const BTN = "${button}";
const HALO = "${halo}";
const BORDER = "${BORDER}";
const BG_HOVER = "${BG_HOVER}";
const BORDER_HOVER = "${BORDER_HOVER}";
export function HomePage() {
  return (
    <div className="relative mb-6">
      <div className={\`absolute inset-0 \${HALO} rounded-full blur-2xl scale-75\`} />
      <SearchX className={\`h-8 w-8 \${ICON}\`} />
      <Button className={\`\${BORDER} \${BTN} \${BG_HOVER} \${BORDER_HOVER}\`}>清除搜索</Button>
    </div>
  );
}`;
}

/** 对一个场景跑口径检查，返回命中的规则代号 */
function rulesOf(source: string): string[] {
  return findHomepageBrandIssues([makeSource(HOMEPAGE_REL, source)]).map(
    (i) => i.rule
  );
}

describe("首页空状态的品牌色口径", () => {
  it("首页文件找得到（否则后面的检查会静默失效）", () => {
    expect(homepage).toBeTruthy();
  });

  it("真实首页没有品牌色口径违规", () => {
    expect(findHomepageBrandIssues(sources).map((i) => i.rule)).toEqual([]);
  });

  it("空状态图标用 text-primary，不带透明度档", () => {
    const icons = findHomepageElements(sources).filter(
      (e) => e.tag === "SearchX" || e.tag === "ClipboardListIcon"
    );
    expect(icons.length).toBe(2);
    for (const icon of icons) {
      expect(icon.tokens).toContain("text-primary");
      expect(icon.tokens).not.toContain("text-primary-strong");
      expect(icon.tokens.filter((t) => /^text-primary\/\d+$/.test(t))).toEqual([]);
    }
  });

  it("清空搜索按钮：hover:text-primary-strong 在，dark:text-primary-strong 不在", () => {
    const buttons = findHomepageElements(sources).filter(
      (e) => e.tag === "Button" && e.tokens.some((t) => /^bg-primary\/\d+$/.test(t))
    );
    expect(buttons.length).toBe(1);
    const button = buttons[0];
    expect(button.tokens).toContain("text-primary-strong");
    expect(button.tokens).toContain("hover:text-primary-strong");
    expect(button.tokens).not.toContain("dark:text-primary-strong");
  });

  it("装饰光晕用会生成 CSS 的档位（不是 /12 这类非档位值）", () => {
    const halos = findHomepageElements(sources).filter((e) =>
      e.tokens.includes("blur-2xl")
    );
    expect(halos.length).toBe(2);
    for (const halo of halos) {
      expect(halo.tokens).toContain("bg-primary/10");
      expect(halo.tokens.filter((t) => /^bg-primary\/\d+$/.test(t) && t !== "bg-primary/10")).toEqual([]);
    }
  });

  it("浅色下 --primary-strong 是 195 80% 30%", () => {
    expect(readPrimaryStrong(css, "root")).toBe("195 80% 30%");
  });

  it("暗色下 --primary-strong 是 195 80% 60%（暗色靠变量，不靠类名）", () => {
    expect(readPrimaryStrong(css, "dark")).toBe("195 80% 60%");
  });
});

describe("首页空状态口径的变异输入", () => {
  it("变异输入：图标改回 text-primary-strong 会被抓出来", () => {
    const rules = rulesOf(emptyState(ICON_STRONG, `${FG_STRONG} ${HOVER_STRONG}`, BG));
    expect(rules).toContain("icon-color");
  });

  it("变异输入：图标文字色带透明度档会被抓出来", () => {
    const rules = rulesOf(emptyState(ICON_TINT, `${FG_STRONG} ${HOVER_STRONG}`, BG));
    expect(rules).toContain("icon-tint");
  });

  it("变异输入：按钮缺 hover:text-primary-strong 会被抓出来", () => {
    const rules = rulesOf(emptyState(ICON_OK, FG_STRONG, BG));
    expect(rules).toContain("button-hover-color");
  });

  it("变异输入：按钮带冗余的 dark:text-primary-strong 会被抓出来", () => {
    const rules = rulesOf(
      emptyState(ICON_OK, `${FG_STRONG} ${HOVER_STRONG} ${DARK_STRONG}`, BG)
    );
    expect(rules).toContain("button-dark-variant");
  });

  it("变异输入：品牌底纹上的文字用实心 text-primary 会被抓出来", () => {
    const rules = rulesOf(emptyState(ICON_OK, `${FG_PLAIN} ${HOVER_STRONG}`, BG));
    expect(rules).toContain("brand-text-on-brand-bg");
  });

  it("变异输入：装饰光晕用 bg-primary/12 会被抓出来", () => {
    const rules = rulesOf(emptyState(ICON_OK, `${FG_STRONG} ${HOVER_STRONG}`, HALO_BAD));
    expect(rules).toContain("non-standard-tint");
  });

  it("变异输入：写法正确时不报任何违规", () => {
    const rules = rulesOf(emptyState(ICON_OK, `${FG_STRONG} ${HOVER_STRONG}`, BG));
    expect(rules).toEqual([]);
  });
});
