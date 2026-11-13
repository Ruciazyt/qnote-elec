import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResizableSidebar, type ResizableSidebarProps } from "./ResizableSidebar";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_WIDTH,
  PANEL_HEADER_PADDING_X,
} from "./layout";

/**
 * 可折叠侧栏的几何回归
 *
 * 这批锁的是「折叠轨道」这一轮修复：折叠态按钮 32×32、固定锚在轨道左起 8px、
 * 折叠态头部 gap 归零、不用 justify-center 居中。
 *
 * 关键：这里的几何是**行内样式**（style={{ width }} / style={{ paddingLeft }}），
 * 不是 Tailwind 类名 —— jsdom 读得到行内样式，读不到类名算出来的盒模型。
 * 所以几何断言直接读 element.style，类名只用来断「gap-0 / h-8 w-8」这类开关。
 */

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

/** 侧栏本体 */
function getAside(): HTMLElement {
  return document.querySelector("aside") as HTMLElement;
}

/** 面板头部行 —— aside 的第一个子元素 */
function getHeaderRow(): HTMLElement {
  return getAside().firstElementChild as HTMLElement;
}

/** 折叠 / 收起按钮 */
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

      // 上一次渲染把折叠状态写进了 localStorage —— 不清掉的话第二次渲染
      // 读到的还是「折叠」，这条就变成同态对比、白跑一趟。
      window.localStorage.clear();

      renderSidebar();
      const expandedPadding = getHeaderRow().style.paddingLeft;

      // 按钮是头部行的第一个子元素，它相对 aside 左缘的偏移就等于头部左内边距。
      // 两态相等 → 折叠↔展开时按钮原地不动，只有面板宽度在变。
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

      // 清掉上一次渲染写下的折叠状态，第二次才是真的展开态
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
      // 标题容器：w-0 归零、opacity-0 淡出、pointer-events-none 不可点
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

      // pointer-events-none 只挡鼠标，挡不住键盘：
      // 里面的按钮仍在 Tab 序里，键盘用户会聚焦到一个看不见的东西上，
      // 焦点框消失、读屏却念出按钮名。必须靠 invisible（visibility:hidden）。
      const titleWrapper = header.children[1] as HTMLElement;
      expect(classTokens(titleWrapper)).toContain("invisible");

      const actionsWrapper = header.children[2] as HTMLElement;
      expect(classTokens(actionsWrapper)).toContain("invisible");
    });

    it("折叠态内容区同样移出焦点序", () => {
      renderSidebar({ defaultCollapsed: true });
      // 内容容器是 aside 的最后一个子元素
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

      // 必须用 shorthand：两个属性的时长与延迟不同（opacity 150ms/0ms，
      // visibility 0s/150ms），只有 shorthand 能一次说清。
      // 写成 transition-property 列表做不到 —— Tailwind 的任意值填的
      // 正是 transition-property，编译出来是
      //   transition-property: opacity 150ms,visibility 0s 150ms;  ← 非法
      // 浏览器会丢弃整条声明，visibility 立即跳变、没有淡出。
      const titleWrapper = header.children[1] as HTMLElement;
      expect(titleWrapper.style.transition).toBe("opacity 150ms, visibility 0s 150ms");

      const actionsWrapper = header.children[2] as HTMLElement;
      expect(actionsWrapper.style.transition).toBe("opacity 150ms, visibility 0s 150ms");

      // 内容区也要一致 —— 此前它只过渡 opacity，visibility 立即跳变，
      // 表现为「标题和操作淡出 300ms、内容瞬间消失」，三块表现不一致。
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
      // 行内 style 优先级最高，但类名里的 transition-opacity 仍会留下误导：
      // 它只过渡 opacity，和 shorthand 的语义重叠。类名里不该再有它。
      expect(classTokens(titleWrapper)).not.toContain("transition-opacity");
    });
  });

  describe("头部形态：只有标题占位（应用管理页的真实 DOM）", () => {
    // 应用管理页不传 actions，头部行里只有标题占位；
    // 题单页头部还有导入、新建两个按钮，是另一种形态。
    // 旧实现里零宽占位节点照样吃 gap，把整行撑到超过内容盒，
    // 再叠上 justify-center 居中，溢出平分到两侧 —— 按钮探出轨道左缘。
    // 现在折叠态 gap 归零 + 固定左内边距锚定，两种形态必须是同一套几何。

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

      // 上一次渲染把折叠状态写进了 localStorage —— 不清掉的话第二次渲染
      // 读到的还是「折叠」，这条就变成同态对比、白跑一趟。
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
