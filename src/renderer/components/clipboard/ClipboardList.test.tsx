import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { ClipboardList } from "./ClipboardList";
import type { ClipboardRecord } from "./types";

/**
 * 剪贴板列表的回归用例
 *
 * 覆盖三块互不重叠的行为：
 *
 * 1.「已复制」徽章（卡片底部、时间戳右边）
 *   - 它一直在 DOM 里，没复制过时靠 opacity-0 + pointer-events-none 藏起来；
 *   - 复制过一次就切成可见态，同时「复制内容」按钮的图标换成对勾；
 *   - 文字色必须走实心 success token —— UI-GUIDELINES 第二节写的是
 *     「文字不要用透明度档」，`/80` 叠在白底上小字过不了 4.5:1。
 *
 * 2. 置顶项的收起/展开
 *   - 置顶项默认只显示一条状态条（类型 + 简述 + 操作栏），正文不渲染；
 *   - 点主区才展开成完整卡片，并给出明确的「收起置顶项」入口；
 *   - 操作栏与主区是兄弟节点，点操作按钮不触发展开。
 *
 * 3. 就地编辑与语法高亮语言徽章
 *   - 编辑态下正文换成 textarea，与只读正文互斥渲染；
 *   - 没改动时保存按钮禁用，改动后可保存，Esc 取消不写库；
 *   - 语言徽章只在已应用格式化语言时出现，编辑态下不出现。
 *
 * jsdom 里 Tailwind 不执行，配色一律断**类名契约**；底色/描边的透明度档是
 * 允许的（规范只禁文字用透明度档），所以只断文字色。
 */

/** 一条文本记录 */
const RECORD: ClipboardRecord = {
  id: 1,
  type: "text",
  content: "const answer = 42;",
  time: new Date("2026-01-01T10:00:00"),
};

/** 一条置顶记录：pinned_at 有值才算置顶 */
const PINNED: ClipboardRecord = {
  ...RECORD,
  pinned_at: 1767225600000,
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

/**
 * 定位置顶项收起条上的主区按钮（点它展开）。
 *
 * 收起条里挤了好几个按钮，其中「更多操作」是 Radix Popover 的触发器 ——
 * Radix 会往触发器上注入 `aria-expanded="false"`，跟主区撞车，
 * 只按 aria-expanded 找会多命中一个。
 * 主区自己的特征是「占满剩余宽度」（class 里有 flex-1），
 * 操作栏里的按钮都是固定尺寸（h-8 w-8）。
 */
function findPinnedSummaryButton(container: HTMLElement): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")).find((btn) =>
      classTokens(btn).includes("flex-1")
    ) ?? null
  );
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

describe("剪贴板列表：置顶项的收起与展开", () => {
  it("置顶项默认收起：只有状态条，没有正文，也没有收起入口", () => {
    const { container } = renderList({ clipboardHistory: [PINNED] });

    // 收起条主区在，且明确标着「未展开」
    const summary = findPinnedSummaryButton(container);
    expect(summary).not.toBeNull();
    expect(summary!.getAttribute("aria-expanded")).toBe("false");

    // 收起态不渲染完整正文
    expect(container.querySelector("pre")).toBeNull();

    // 「收起置顶项」是展开态才给的入口，收起时不该出现
    expect(screen.queryByRole("button", { name: "收起置顶项" })).toBeNull();
  });

  it("点主区展开置顶项：正文出现，并给出收起入口", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ clipboardHistory: [PINNED] });

    await user.click(findPinnedSummaryButton(container)!);

    // 正文回来了
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("const answer = 42;");

    // 展开态有明确的收起入口
    expect(screen.getByRole("button", { name: "收起置顶项" })).toBeInTheDocument();

    // 收起条整块被展开态顶替了
    expect(findPinnedSummaryButton(container)).toBeNull();
  });

  it("收起条上的操作按钮不触发展开", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const { container } = renderList({ clipboardHistory: [PINNED], onCopy });

    await user.click(screen.getByRole("button", { name: "复制内容" }));

    expect(onCopy).toHaveBeenCalledWith(PINNED.content, "text");
    // 操作栏与主区是兄弟节点，复制不该把正文带出来
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.queryByRole("button", { name: "收起置顶项" })).toBeNull();
  });

  it("收起态的编辑入口会先把置顶项展开，再进编辑态", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ clipboardHistory: [PINNED] });

    await user.click(screen.getByRole("button", { name: "编辑内容" }));

    // 编辑框有地方待着了：置顶项已经被展开
    expect(screen.getByLabelText("编辑剪贴板内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起置顶项" })).toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("剪贴板列表：就地编辑", () => {
  it("点编辑进编辑态：正文换成编辑框，入口按钮改名为退出编辑", async () => {
    const user = userEvent.setup();
    const { container } = renderList();

    await user.click(screen.getByRole("button", { name: "编辑内容" }));

    const textarea = screen.getByLabelText("编辑剪贴板内容") as HTMLTextAreaElement;
    expect(textarea.value).toBe(RECORD.content);

    // 只读正文与编辑框互斥渲染
    expect(container.querySelector("pre")).toBeNull();

    // 入口按钮换了名：同一个人一眼能看出当前能不能退出编辑
    expect(screen.getByRole("button", { name: "退出编辑" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑内容" })).toBeNull();

    // 编辑态是独立的一套视觉状态（浮起），不是只读态加个边框
    expect(container.querySelector(".neu-raised-open")).not.toBeNull();
  });

  it("没改动时保存按钮禁用，改动后可保存并写库", async () => {
    const user = userEvent.setup();
    const onUpdateContent = vi.fn().mockResolvedValue(undefined);
    renderList({ onUpdateContent });

    await user.click(screen.getByRole("button", { name: "编辑内容" }));

    const save = screen.getByRole("button", { name: "保存" });
    // 草稿和原文一致，没必要写库
    expect(save).toBeDisabled();

    const textarea = screen.getByLabelText("编辑剪贴板内容");
    await user.clear(textarea);
    await user.type(textarea, "const answer = 43;");

    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(onUpdateContent).toHaveBeenCalledWith(RECORD, "const answer = 43;"));
    // 存完退出编辑态
    expect(screen.queryByLabelText("编辑剪贴板内容")).toBeNull();
  });

  it("Esc 取消编辑：回到只读态，且不写库", async () => {
    const user = userEvent.setup();
    const onUpdateContent = vi.fn().mockResolvedValue(undefined);
    renderList({ onUpdateContent });

    await user.click(screen.getByRole("button", { name: "编辑内容" }));
    const textarea = screen.getByLabelText("编辑剪贴板内容");
    await user.clear(textarea);
    await user.type(textarea, "改了但不保存");

    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("编辑剪贴板内容")).toBeNull();
    expect(onUpdateContent).not.toHaveBeenCalled();
  });

  it("保存失败时保留编辑态，不把用户改的东西吞掉", async () => {
    const user = userEvent.setup();
    const onUpdateContent = vi.fn().mockRejectedValue(new Error("写库失败"));
    renderList({ onUpdateContent });

    await user.click(screen.getByRole("button", { name: "编辑内容" }));
    const textarea = screen.getByLabelText("编辑剪贴板内容");
    await user.clear(textarea);
    await user.type(textarea, "写不进去的内容");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onUpdateContent).toHaveBeenCalled());
    // 存失败时编辑框还在，草稿还在
    expect(screen.getByLabelText("编辑剪贴板内容")).toBeInTheDocument();
    expect((screen.getByLabelText("编辑剪贴板内容") as HTMLTextAreaElement).value).toBe(
      "写不进去的内容"
    );
  });
});

describe("剪贴板列表：语法高亮语言徽章", () => {
  it("已应用格式化语言时显示语言徽章", () => {
    const { container } = renderList({ formattedLanguages: { 1: "typescript" } });

    const badge = container.querySelector(".lang-active-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("TypeScript");
    // 徽章里带对勾，和「已复制」徽章区分得开
    expect(badge!.querySelector("svg")).not.toBeNull();
  });

  it("没有应用格式化语言时不显示语言徽章", () => {
    const { container } = renderList();

    expect(container.querySelector(".lang-active-badge")).toBeNull();
  });

  it("编辑态下不显示语言徽章：正文已被编辑框接管", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ formattedLanguages: { 1: "typescript" } });

    expect(container.querySelector(".lang-active-badge")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "编辑内容" }));

    expect(container.querySelector(".lang-active-badge")).toBeNull();
  });
});
