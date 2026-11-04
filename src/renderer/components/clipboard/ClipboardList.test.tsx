import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { ClipboardList } from "./ClipboardList";
import type { ClipboardRecord } from "./types";

/**
 * 剪贴板列表「已复制」徽章的回归用例
 *
 * 这批用例锁的是复制成功后的那一枚小徽章（卡片底部、时间戳右边）：
 * - 它一直在 DOM 里，没复制过时靠 opacity-0 + pointer-events-none 藏起来；
 * - 复制过一次就切成可见态，同时「复制内容」按钮的图标换成对勾；
 * - 文字色必须走实心 success token —— UI-GUIDELINES 第二节写的是
 *   「文字不要用透明度档」，`/80` 叠在白底上小字过不了 4.5:1。
 *
 * jsdom 里 Tailwind 不执行，徽章的显隐与配色都只能断**类名契约**；
 * 底色/描边的透明度档是允许的（规范只禁文字用透明度档），所以只断文字色。
 */

/** 一条文本记录 */
const RECORD: ClipboardRecord = {
  id: 1,
  type: "text",
  content: "const answer = 42;",
  time: new Date("2026-01-01T10:00:00"),
};

/** 取 class 里的每个 token，便于精确断言某个工具类在不在 */
function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * 找到「已复制」徽章。
 *
 * 不用 getByText：复制按钮的 Tooltip 文案在复制后也会变成「已复制」，
 * 那段文字在 Radix 浮层里、标签是 <p>，和徽章的 <span> 不是一回事。
 * 徽章的识别特征是「span + 文本是「已复制」+ 里面有一个对勾图标」。
 */
function findBadge(root: HTMLElement): HTMLElement {
  const badge = Array.from(root.querySelectorAll("span")).find(
    (el) => el.textContent?.trim() === "已复制" && el.querySelector("svg.lucide-check") !== null
  );
  if (!badge) throw new Error("没找到「已复制」徽章");
  return badge as HTMLElement;
}

function renderList(overrides: Partial<ComponentProps<typeof ClipboardList>> = {}) {
  const onCopy = vi.fn();
  const props: ComponentProps<typeof ClipboardList> = {
    clipboardHistory: [RECORD],
    formattedLanguages: {},
    formattingRecordId: undefined,
    onFormatCode: vi.fn(),
    onCopy,
    onDeleteRecord: vi.fn(),
    onAddToVector: vi.fn(),
    onImageClick: vi.fn(),
    codeContainerRef: { current: null },
    ...overrides,
  };
  const { container } = render(<ClipboardList {...props} />);
  return { container, onCopy };
}

describe("剪贴板列表「已复制」徽章", () => {
  it("徽章一直在 DOM 里，没复制过时不可见也不可点", () => {
    const { container } = renderList();

    const badge = findBadge(container);
    const tokens = classTokens(badge);

    // 复制前：藏起来 + 不接收点击（不挡住卡片上的其他操作）
    expect(tokens).toContain("opacity-0");
    expect(tokens).toContain("pointer-events-none");
    expect(tokens).not.toContain("opacity-100");
  });

  it("点复制后徽章切成可见态，并调 onCopy", async () => {
    const user = userEvent.setup();
    const { container, onCopy } = renderList();

    const copyButtons = screen.getAllByRole("button", { name: "复制内容" });
    expect(copyButtons).toHaveLength(1);
    await user.click(copyButtons[0]);

    expect(onCopy).toHaveBeenCalledWith(RECORD.content, "text");

    const tokens = classTokens(findBadge(container));
    expect(tokens).toContain("opacity-100");
    expect(tokens).toContain("scale-100");
    expect(tokens).toContain("copied-badge-spring");
    expect(tokens).not.toContain("opacity-0");
  });

  it("徽章的文字色走实心 success token，不用透明度档", () => {
    const { container } = renderList();

    const tokens = classTokens(findBadge(container));

    // 实心：text-success
    expect(tokens).toContain("text-success");
    // 没有任何 success 文字的透明度档（text-success/80、dark:text-success/90 都不行）
    expect(tokens.filter((t) => /^((dark:)?text-success)\/\d+$/.test(t))).toEqual([]);
  });
});
