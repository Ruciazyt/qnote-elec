import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./SideBar";
import { createElectronStub } from "../../test/electron-stub";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_WIDTH,
  PANEL_HEADER_PADDING_X,
} from "@/components/panel/layout";

/**
 * 题单页侧栏折叠按钮的回归用例
 *
 * 这批用例锁的是「折叠态几何」这一轮改动：折叠按钮 36px→32px、折叠态头部行
 * 改用 pl-1 定位、去掉折叠态容器的 items-center、头部图标按钮统一 32px、
 * 补 aria-expanded。
 *
 * jsdom 里 Tailwind 的 w-10 / pl-1 / h-8 不产生盒模型，量不到真实像素，
 * 所以断言全部落在**类名契约**上 —— 这些类名就是这次改动要保护的东西，
 * 真要量几何得上真实浏览器（见 docs/UI-GUIDELINES.md 第九节的做法）。
 */

/** 折叠状态在 localStorage 里的 key：换了 key 用户已保存的折叠偏好就没了 */
const STORAGE_KEY = "leetcode-sidebar-collapsed";

/** 一条题单，展开态下会渲染成卡片 */
const COLLECTION = {
  id: 7,
  name: "动态规划专题",
  summary: "DP 入门",
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
};

/** 第二条题单 —— 用来验「同页多张卡片，按钮名称要能区分」 */
const OTHER_COLLECTION = {
  id: 8,
  name: "图论专题",
  summary: "最短路",
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
};

/** 取 class 里的每个 token，便于精确断言某个工具类在不在 */
function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** 折叠按钮：aria-label 在「展开侧栏 / 收起侧栏」之间切换 */
function getToggle(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^(展开侧栏|收起侧栏)$/ }) as HTMLButtonElement;
}

/** 头部行 = 折叠按钮所在的 div */
function getHeaderRow(): HTMLElement {
  return getToggle().parentElement as HTMLElement;
}

/**
 * 渲染侧栏。
 *
 * 组件挂载后会异步拉一次题单列表，所以渲染完要等这次 promise 落定 ——
 * 否则状态更新落在 act 之外，测试日志里会刷 act 警告。
 */
async function renderSidebar(
  overrides: Record<string, unknown> = {}
): Promise<{
  container: HTMLElement;
  unmount: () => void;
  onSelectCollection: ReturnType<typeof vi.fn>;
}> {
  window.electron = createElectronStub({
    getLeetcodeCollections: vi.fn().mockResolvedValue([COLLECTION]),
    ...overrides,
  });

  const onSelectCollection = vi.fn();
  const { container, unmount } = render(
    <Sidebar onSelectCollection={onSelectCollection} selectedCollectionId={null} />
  );

  await act(async () => {
    await Promise.resolve();
  });

  return { container, unmount, onSelectCollection };
}

describe("题单页侧栏折叠按钮", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("折叠态", () => {
    it("渲染出「展开侧栏」按钮，aria-expanded 为 false，图标指向右侧", async () => {
      await renderSidebar();

      const toggle = getToggle();
      expect(toggle).toHaveAttribute("aria-label", "展开侧栏");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle.querySelector("svg")).toHaveClass("lucide-chevron-right");
    });

    it("不渲染标题与导入、新建按钮", async () => {
      await renderSidebar();

      expect(screen.queryByText("题单")).toBeNull();
      expect(screen.queryByRole("button", { name: "导入题单" })).toBeNull();
      expect(screen.queryByRole("button", { name: "新建题单" })).toBeNull();
      expect(getHeaderRow().querySelectorAll("button")).toHaveLength(1);
    });
  });

  describe("展开态", () => {
    beforeEach(() => {
      // useCollapsedState 初值取自 localStorage，写 false 即展开
      window.localStorage.setItem(STORAGE_KEY, "false");
    });

    it("渲染出「收起侧栏」按钮，aria-expanded 为 true，图标指向左侧", async () => {
      await renderSidebar();

      const toggle = getToggle();
      expect(toggle).toHaveAttribute("aria-label", "收起侧栏");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle.querySelector("svg")).toHaveClass("lucide-chevron-left");
    });

    it("同时渲染标题「题单」与导入、新建两个按钮", async () => {
      await renderSidebar();

      expect(screen.getByText("题单")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "导入题单" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "新建题单" })).toBeInTheDocument();

      // 折叠 + 导入 + 新建
      expect(getHeaderRow().querySelectorAll("button")).toHaveLength(3);
    });
  });

  describe("按钮尺寸契约", () => {
    it("折叠按钮固定 32px 方钮，不会被改回 36px", async () => {
      await renderSidebar();

      const toggle = getToggle();
      expect(toggle).toHaveClass("h-8", "w-8");

      const tokens = classTokens(toggle);
      // 36px = h-9 w-9，是 size="icon" 的默认尺寸，被 className 里的 h-8 w-8 覆盖掉了
      expect(tokens).not.toContain("h-9");
      expect(tokens).not.toContain("w-9");
    });

    it("折叠按钮是 icon 尺寸：方形且没有水平内边距", async () => {
      await renderSidebar();

      // size="default" 带 px-4、size="sm" 带 px-3，icon 尺寸两者都没有
      const padding = classTokens(getToggle()).filter((t) => t.startsWith("px-"));
      expect(padding).toEqual([]);
    });

    it("折叠按钮的图标是 16px", async () => {
      await renderSidebar();

      expect(getToggle().querySelector("svg")).toHaveClass("h-4", "w-4");
    });
  });

  describe("头部行内边距", () => {
    it("折叠态左内边距取共享常量 PANEL_COLLAPSED_BUTTON_INSET，右内边距归零", async () => {
      await renderSidebar();

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe(`${PANEL_COLLAPSED_BUTTON_INSET}px`);
      expect(header.style.paddingRight).toBe("0px");
    });

    it("展开态左右内边距取共享常量 PANEL_HEADER_PADDING_X", async () => {
      window.localStorage.setItem(STORAGE_KEY, "false");
      await renderSidebar();

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe(`${PANEL_HEADER_PADDING_X}px`);
      expect(header.style.paddingRight).toBe(`${PANEL_HEADER_PADDING_X}px`);
    });

    it("两态左内边距相同 —— 按钮相对侧栏左缘零横向位移", async () => {
      const first = await renderSidebar();
      const collapsedPadding = getHeaderRow().style.paddingLeft;
      first.unmount();

      window.localStorage.setItem(STORAGE_KEY, "false");
      await renderSidebar();
      const expandedPadding = getHeaderRow().style.paddingLeft;

      // 按钮是头部行的第一个子元素，它相对侧栏左缘的偏移就等于头部左内边距。
      // 两态相等 → 切换时按钮原地不动，只有面板宽度在变。
      expect(collapsedPadding).toBe(expandedPadding);
    });
  });

  describe("折叠态容器", () => {
    it("折叠态侧栏宽度取共享常量 PANEL_COLLAPSED_WIDTH", async () => {
      const { container } = await renderSidebar();

      const root = container.firstElementChild as HTMLElement;
      expect(root.style.width).toBe(`${PANEL_COLLAPSED_WIDTH}px`);
    });

    it("展开态宽度走 w-64（这一页不支持拖拽调宽，维持原状）", async () => {
      window.localStorage.setItem(STORAGE_KEY, "false");
      const { container } = await renderSidebar();

      const root = container.firstElementChild as HTMLElement;
      expect(classTokens(root)).toContain("w-64");
      expect(root.style.width).toBe("");
    });

    it("容器不做 items-center 居中", async () => {
      const { container } = await renderSidebar();

      // 轨道右侧有 1px 边框，内容盒只有 47px，再居中会让按钮落到 7.5..39.5，左右差 0.5px
      const root = container.firstElementChild as HTMLElement;
      expect(classTokens(root)).not.toContain("items-center");
    });

    it("头部行不用 px-/pl- 类（内边距走行内样式，才跟共享常量联动）", async () => {
      await renderSidebar();

      const tokens = classTokens(getHeaderRow());
      expect(tokens.filter((t) => t.startsWith("px-"))).toEqual([]);
      expect(tokens.filter((t) => t.startsWith("pl-"))).toEqual([]);
    });

    it("头部行裁掉溢出内容（宽度过渡那一帧不能画到主内容区上）", async () => {
      await renderSidebar();

      expect(classTokens(getHeaderRow())).toContain("overflow-hidden");
    });
  });

  describe("点击切换", () => {
    it("点一下展开，再点一下收起", async () => {
      const user = userEvent.setup();
      await renderSidebar();

      expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
      expect(screen.queryByText("题单")).toBeNull();

      await user.click(getToggle());

      expect(screen.getByRole("button", { name: "收起侧栏" })).toBeInTheDocument();
      expect(screen.getByText("题单")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "收起侧栏" }));

      expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
      expect(screen.queryByText("题单")).toBeNull();
    });
  });

  describe("折叠状态持久化", () => {
    it("沿用既有的 localStorage key 存储折叠状态", async () => {
      const user = userEvent.setup();
      await renderSidebar();

      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

      await user.click(getToggle());

      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
    });

    it("重新挂载后按 localStorage 恢复折叠状态", async () => {
      const user = userEvent.setup();
      const first = await renderSidebar();

      // 切到展开
      await user.click(getToggle());
      first.unmount();

      const second = await renderSidebar();
      expect(screen.getByRole("button", { name: "收起侧栏" })).toBeInTheDocument();
      expect(screen.getByText("题单")).toBeInTheDocument();

      // 再切回折叠
      await user.click(getToggle());
      second.unmount();

      await renderSidebar();
      expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
      expect(screen.queryByText("题单")).toBeNull();
    });
  });

  describe("无障碍", () => {
    it("折叠按钮有可读名称，装饰性图标不污染名称", async () => {
      await renderSidebar();

      const toggle = getToggle();
      expect(toggle).toHaveAccessibleName("展开侧栏");

      const icon = toggle.querySelector("svg");
      expect(icon).not.toHaveAttribute("aria-label");
      expect(icon?.querySelector("title")).toBeNull();
    });

    it("导入、新建按钮都有可读名称", async () => {
      window.localStorage.setItem(STORAGE_KEY, "false");
      await renderSidebar();

      // 这两个按钮只有图标，可读名称全靠 aria-label ——
      // 少一个 aria-label，屏幕阅读器就读不出是「导入」还是「新建」。
      expect(screen.getByRole("button", { name: "导入题单" })).toHaveAccessibleName("导入题单");
      expect(screen.getByRole("button", { name: "新建题单" })).toHaveAccessibleName("新建题单");

      // 名称的来源锁到 aria-label：title 只是原生悬停提示，哪天界面规范不要原生
      // title，去掉后名称仍然成立；但 aria-label 少了要能报错。
      expect(screen.getByRole("button", { name: "导入题单" })).toHaveAttribute(
        "aria-label",
        "导入题单"
      );
      expect(screen.getByRole("button", { name: "新建题单" })).toHaveAttribute(
        "aria-label",
        "新建题单"
      );
    });

    it("题单卡片上的编辑、删除按钮都有可读名称，且带题单名", async () => {
      window.localStorage.setItem(STORAGE_KEY, "false");
      await renderSidebar({
        getLeetcodeCollections: vi.fn().mockResolvedValue([COLLECTION, OTHER_COLLECTION]),
      });

      await screen.findByText("动态规划专题");

      expect(screen.getByRole("button", { name: "编辑题单：动态规划专题" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "删除题单：动态规划专题" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "编辑题单：图论专题" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "删除题单：图论专题" })).toBeInTheDocument();

      // 同页两张卡片，编辑/删除按钮各有两个，名称互不相同
      const editButtons = screen.getAllByRole("button", { name: /^编辑题单：/ });
      const deleteButtons = screen.getAllByRole("button", { name: /^删除题单：/ });
      expect(editButtons).toHaveLength(2);
      expect(deleteButtons).toHaveLength(2);
      expect(new Set(editButtons.map((b) => b.getAttribute("aria-label"))).size).toBe(2);
    });

    // 已启用：@浏览器工具开发 已把删除确认框的正文改成 DialogDescription 承载，
    // 目标名在打开弹窗那一刻存进 state（UI设计校验 的改动清单）。
    it("删除确认弹窗的描述节点里带着题单名", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(STORAGE_KEY, "false");
      await renderSidebar();

      await screen.findByText("动态规划专题");
      await user.click(screen.getByRole("button", { name: "删除题单：动态规划专题" }));

      // 弹窗打开那一瞬间，读屏念的是 aria-describedby 指向的那段文本。
      // ui/dialog 不会自动生成描述节点 —— 只有真的渲染了 DialogDescription，
      // Radix 才会把它的 id 接上去；正文放在普通 <p> 里就等于没被朗读，
      // 「删的是哪一个」用户还是听不出来。
      const dialog = screen.getByRole("dialog");
      const describedBy = dialog.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();

      const description = document.getElementById(describedBy!);
      expect(description?.textContent).toContain("动态规划专题");
    });
  });

  describe("题单列表", () => {
    it("展开态按主进程返回的数据渲染题单卡片，点卡片回调题单 id", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(STORAGE_KEY, "false");
      const { onSelectCollection } = await renderSidebar();

      const card = await screen.findByText("动态规划专题");
      await user.click(card);

      expect(onSelectCollection).toHaveBeenCalledWith(COLLECTION.id);
    });
  });
});
