import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResizableSidebar, type ResizableSidebarProps } from "./ResizableSidebar";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_WIDTH,
  PANEL_HEADER_PADDING_X,
} from "./layout";


const STORAGE_KEY = "qnote-test-panel";

function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function renderSidebar(props: Partial<ResizableSidebarProps> = {}) {
  const onCollapsedChange = vi.fn();
  const utils = render(
    <div className="flex-1 min-h-0 flex">
      <ResizableSidebar
        storageKey={STORAGE_KEY}
        title={<span>项目</span>}
        actions={
          <button type="button" onClick={() => {}}>
            导入
          </button>
        }
        onCollapsedChange={onCollapsedChange}
        {...props}>
        <div>内容</div>
      </ResizableSidebar>
    </div>
  );
  return { ...utils, onCollapsedChange };
}

function getAside(): HTMLElement {
  return document.querySelector("aside") as HTMLElement;
}

function getHeaderRow(): HTMLElement {
  return getAside().firstElementChild as HTMLElement;
}

function getToggle(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^(展开侧栏|收起侧栏)$/ }) as HTMLButtonElement;
}

describe("可折叠侧栏（ResizableSidebar）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("轨道宽度", () => {
    it("折叠态宽度等于共享常量 PANEL_COLLAPSED_WIDTH", () => {
      renderSidebar({ defaultCollapsed: true });

      expect(getAside().style.width).toBe(`${PANEL_COLLAPSED_WIDTH}px`);
    });

    it("展开态宽度等于 usePanelWidth 给出的宽度", () => {
      renderSidebar({ defaultWidth: 320 });

      expect(getAside().style.width).toBe("320px");
    });

    it("展开态宽度按 localStorage 里存的值恢复", () => {
      window.localStorage.setItem(`${STORAGE_KEY}-width`, "400");
      renderSidebar({ defaultWidth: 320 });

      expect(getAside().style.width).toBe("400px");
    });
  });

  describe("头部行内边距", () => {
    it("折叠态左内边距等于 PANEL_COLLAPSED_BUTTON_INSET，右内边距归零", () => {
      renderSidebar({ defaultCollapsed: true });

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe(`${PANEL_COLLAPSED_BUTTON_INSET}px`);
      expect(header.style.paddingRight).toBe("0px");
    });

    it("展开态左右内边距都等于 PANEL_HEADER_PADDING_X", () => {
      renderSidebar();

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe(`${PANEL_HEADER_PADDING_X}px`);
      expect(header.style.paddingRight).toBe(`${PANEL_HEADER_PADDING_X}px`);
    });

    it("两态头部左内边距相同 —— 按钮相对侧栏左缘零横向位移", () => {
      const { unmount } = renderSidebar({ defaultCollapsed: true });
      const collapsedPadding = getHeaderRow().style.paddingLeft;
      unmount();

      window.localStorage.clear();

      renderSidebar();
      const expandedPadding = getHeaderRow().style.paddingLeft;

      expect(collapsedPadding).toBe(expandedPadding);
    });
  });

  describe("头部行 gap", () => {
    it("折叠态 gap 为 0（标题与操作区虽然宽度归零，gap 照样占位）", () => {
      renderSidebar({ defaultCollapsed: true });

      const tokens = classTokens(getHeaderRow());
      expect(tokens).toContain("gap-0");
      expect(tokens).not.toContain("gap-2");
    });

    it("展开态 gap 为 2", () => {
      renderSidebar();

      const tokens = classTokens(getHeaderRow());
      expect(tokens).toContain("gap-2");
      expect(tokens).not.toContain("gap-0");
    });
  });

  describe("折叠按钮", () => {
    it("两态都是 32×32（不会被改回 icon 默认的 36px）", () => {
      const { unmount } = renderSidebar({ defaultCollapsed: true });

      let tokens = classTokens(getToggle());
      expect(tokens).toContain("h-8");
      expect(tokens).toContain("w-8");
      expect(tokens).not.toContain("h-9");
      expect(tokens).not.toContain("w-9");
      unmount();

      window.localStorage.clear();

      renderSidebar();

      tokens = classTokens(getToggle());
      expect(tokens).toContain("h-8");
      expect(tokens).toContain("w-8");
      expect(tokens).not.toContain("h-9");
      expect(tokens).not.toContain("w-9");
    });

    it("折叠态标为「展开侧栏」，展开态标为「收起侧栏」", () => {
      const { unmount } = renderSidebar({ defaultCollapsed: true });

      expect(getToggle()).toHaveAttribute("aria-label", "展开侧栏");
      expect(getToggle()).toHaveAttribute("aria-expanded", "false");
      unmount();

      window.localStorage.clear();

      renderSidebar();

      expect(getToggle()).toHaveAttribute("aria-label", "收起侧栏");
      expect(getToggle()).toHaveAttribute("aria-expanded", "true");
    });

    it("点击在折叠与展开之间切换", async () => {
      const user = userEvent.setup();
      renderSidebar();

      await user.click(getToggle());

      expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
      expect(getAside().style.width).toBe(`${PANEL_COLLAPSED_WIDTH}px`);
    });
  });

  describe("分割线", () => {
    it("折叠态不渲染 PanelResizer（侧栏已经退化成一条按钮轨）", () => {
      renderSidebar({ defaultCollapsed: true });

      expect(screen.queryByRole("slider")).toBeNull();
    });

    it("展开态渲染 PanelResizer", () => {
      renderSidebar();

      expect(screen.getByRole("slider", { name: "调整侧栏宽度" })).toBeInTheDocument();
    });
  });

  describe("折叠与展开的内容", () => {
    it("折叠态标题与操作区退场（宽度归零 + 淡出 + 不可点）", () => {
      renderSidebar({ defaultCollapsed: true });

      const header = getHeaderRow();
      const titleWrapper = header.children[1] as HTMLElement;
      const tokens = classTokens(titleWrapper);
      expect(tokens).toContain("w-0");
      expect(tokens).toContain("opacity-0");
      expect(tokens).toContain("pointer-events-none");
    });

    it("展开态标题与操作区正常显示", () => {
      renderSidebar();

      const titleWrapper = getHeaderRow().children[1] as HTMLElement;
      const tokens = classTokens(titleWrapper);
      expect(tokens).toContain("opacity-100");
      expect(tokens).not.toContain("w-0");
      expect(screen.getByRole("button", { name: "导入" })).toBeInTheDocument();
    });

    it("折叠态标题与操作区真正移出焦点序（invisible），键盘不会 Tab 到看不见的按钮", () => {
      renderSidebar({ defaultCollapsed: true });
      const header = getHeaderRow();

      const titleWrapper = header.children[1] as HTMLElement;
      expect(classTokens(titleWrapper)).toContain("invisible");

      const actionsWrapper = header.children[2] as HTMLElement;
      expect(classTokens(actionsWrapper)).toContain("invisible");
    });

    it("折叠态内容区同样移出焦点序", () => {
      renderSidebar({ defaultCollapsed: true });
      const content = getAside().lastElementChild as HTMLElement;
      expect(classTokens(content)).toContain("invisible");
    });

    it("展开态标题、操作区与内容都恢复可见（visible）", () => {
      renderSidebar();
      const header = getHeaderRow();

      const titleWrapper = header.children[1] as HTMLElement;
      expect(classTokens(titleWrapper)).toContain("visible");
      expect(classTokens(titleWrapper)).not.toContain("invisible");

      const actionsWrapper = header.children[2] as HTMLElement;
      expect(classTokens(actionsWrapper)).toContain("visible");
      expect(classTokens(actionsWrapper)).not.toContain("invisible");

      const content = getAside().lastElementChild as HTMLElement;
      expect(classTokens(content)).toContain("visible");
      expect(classTokens(content)).not.toContain("invisible");
    });

    it("退场动效是一条 transition shorthand —— opacity 立即淡、visibility 延迟到淡完再切", () => {
      renderSidebar({ defaultCollapsed: true });
      const header = getHeaderRow();

      const titleWrapper = header.children[1] as HTMLElement;
      expect(titleWrapper.style.transition).toBe("opacity 150ms, visibility 0s 150ms");

      const actionsWrapper = header.children[2] as HTMLElement;
      expect(actionsWrapper.style.transition).toBe("opacity 150ms, visibility 0s 150ms");

      const content = getAside().lastElementChild as HTMLElement;
      expect(content.style.transition).toBe("opacity 150ms, visibility 0s 150ms");
    });

    it("展开动效：visibility 立即可见、opacity 淡入（不延迟）", () => {
      renderSidebar();
      const header = getHeaderRow();

      const titleWrapper = header.children[1] as HTMLElement;
      expect(titleWrapper.style.transition).toBe("opacity 150ms, visibility 0s 0ms");

      const actionsWrapper = header.children[2] as HTMLElement;
      expect(actionsWrapper.style.transition).toBe("opacity 150ms, visibility 0s 0ms");

      const content = getAside().lastElementChild as HTMLElement;
      expect(content.style.transition).toBe("opacity 150ms, visibility 0s 0ms");
    });

    it("退场态不再由类名带 transition-opacity（会和行内 shorthand 打架）", () => {
      renderSidebar({ defaultCollapsed: true });
      const titleWrapper = getHeaderRow().children[1] as HTMLElement;
      expect(classTokens(titleWrapper)).not.toContain("transition-opacity");
    });
  });

  describe("头部形态：只有标题占位（应用管理页的真实 DOM）", () => {

    it("折叠态头部行 gap 归零，左内边距 8px、右 0px", () => {
      renderSidebar({ defaultCollapsed: true, actions: undefined });

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe(`${PANEL_COLLAPSED_BUTTON_INSET}px`);
      expect(header.style.paddingRight).toBe("0px");

      const tokens = classTokens(header);
      expect(tokens).toContain("gap-0");
      expect(tokens).not.toContain("gap-2");
    });

    it("折叠态轨道宽 48px，容器不做 items-center 居中", () => {
      renderSidebar({ defaultCollapsed: true, actions: undefined });

      expect(getAside().style.width).toBe(`${PANEL_COLLAPSED_WIDTH}px`);
      expect(classTokens(getAside())).not.toContain("items-center");
    });

    it("标题占位照样退场（宽度归零、淡出、不可点）", () => {
      renderSidebar({ defaultCollapsed: true, actions: undefined });

      const titleWrapper = getHeaderRow().children[1] as HTMLElement;
      const tokens = classTokens(titleWrapper);
      expect(tokens).toContain("w-0");
      expect(tokens).toContain("opacity-0");
      expect(tokens).toContain("pointer-events-none");
    });

    it("两态头部左内边距相同 —— 按钮相对侧栏左缘零横向位移", () => {
      const first = renderSidebar({ defaultCollapsed: true, actions: undefined });
      const collapsedPadding = getHeaderRow().style.paddingLeft;
      first.unmount();

      window.localStorage.clear();

      renderSidebar({ actions: undefined });

      expect(getHeaderRow().style.paddingLeft).toBe(collapsedPadding);
    });
  });

  describe("状态持久化", () => {
    it("折叠状态写进 localStorage 的既有 key", async () => {
      const user = userEvent.setup();
      renderSidebar();

      expect(window.localStorage.getItem(`${STORAGE_KEY}-collapsed`)).toBe("false");

      await user.click(getToggle());

      expect(window.localStorage.getItem(`${STORAGE_KEY}-collapsed`)).toBe("true");
    });

    it("宽度写进 usePanelWidth 的 key", () => {
      renderSidebar({ defaultWidth: 320 });

      expect(window.localStorage.getItem(`${STORAGE_KEY}-width`)).toBe("320");
    });

    it("重新挂载后按 localStorage 恢复折叠状态", async () => {
      const user = userEvent.setup();
      const first = renderSidebar();

      await user.click(getToggle());
      first.unmount();

      renderSidebar();

      expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
      expect(getAside().style.width).toBe(`${PANEL_COLLAPSED_WIDTH}px`);
    });

    it("折叠状态变化会通知父组件", async () => {
      const user = userEvent.setup();
      const { onCollapsedChange } = renderSidebar();

      await user.click(getToggle());

      expect(onCollapsedChange).toHaveBeenLastCalledWith(true);
    });
  });
});
