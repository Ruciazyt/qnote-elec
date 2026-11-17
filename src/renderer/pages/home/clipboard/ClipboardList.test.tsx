import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { ClipboardList } from "./ClipboardList";
import type { ClipboardRecord } from "./types";


const RECORD: ClipboardRecord = {
  id: 1,
  type: "text",
  content: "const answer = 42;",
  time: new Date("2026-01-01T10:00:00"),
};

const PINNED: ClipboardRecord = {
  ...RECORD,
  pinned_at: 1767225600000,
};

function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

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

    expect(tokens).toContain("text-success");
    expect(tokens.filter((t) => /^((dark:)?text-success)\/\d+$/.test(t))).toEqual([]);
  });
});

describe("剪贴板列表：置顶项的收起与展开", () => {
  it("置顶项默认收起：只有状态条，没有正文，也没有收起入口", () => {
    const { container } = renderList({ clipboardHistory: [PINNED] });

    const summary = findPinnedSummaryButton(container);
    expect(summary).not.toBeNull();
    expect(summary!.getAttribute("aria-expanded")).toBe("false");

    expect(container.querySelector("pre")).toBeNull();

    expect(screen.queryByRole("button", { name: "收起置顶项" })).toBeNull();
  });

  it("点主区展开置顶项：正文出现，并给出收起入口", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ clipboardHistory: [PINNED] });

    await user.click(findPinnedSummaryButton(container)!);

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("const answer = 42;");

    expect(screen.getByRole("button", { name: "收起置顶项" })).toBeInTheDocument();

    expect(findPinnedSummaryButton(container)).toBeNull();
  });

  it("收起条上的操作按钮不触发展开", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const { container } = renderList({ clipboardHistory: [PINNED], onCopy });

    await user.click(screen.getByRole("button", { name: "复制内容" }));

    expect(onCopy).toHaveBeenCalledWith(PINNED.content, "text");
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.queryByRole("button", { name: "收起置顶项" })).toBeNull();
  });

  it("收起态的编辑入口会先把置顶项展开，再进编辑态", async () => {
    const user = userEvent.setup();
    const { container } = renderList({ clipboardHistory: [PINNED] });

    await user.click(screen.getByRole("button", { name: "编辑内容" }));

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

    expect(container.querySelector("pre")).toBeNull();

    expect(screen.getByRole("button", { name: "退出编辑" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑内容" })).toBeNull();

    expect(container.querySelector(".neu-raised-open")).not.toBeNull();
  });

  it("没改动时保存按钮禁用，改动后可保存并写库", async () => {
    const user = userEvent.setup();
    const onUpdateContent = vi.fn().mockResolvedValue(undefined);
    renderList({ onUpdateContent });

    await user.click(screen.getByRole("button", { name: "编辑内容" }));

    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();

    const textarea = screen.getByLabelText("编辑剪贴板内容");
    await user.clear(textarea);
    await user.type(textarea, "const answer = 43;");

    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(onUpdateContent).toHaveBeenCalledWith(RECORD, "const answer = 43;"));
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
