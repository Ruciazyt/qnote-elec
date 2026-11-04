import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutPanel } from "./ShortcutPanel";
import { SHORTCUT_PANEL_COLLAPSED_WIDTH, SHORTCUT_PANEL_WIDTH } from "./types";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_BUTTON_SIZE,
  PANEL_HEADER_PADDING_X,
  PANEL_RAIL_LABEL_INSET,
} from "@/components/panel/layout";
import { createElectronStub } from "../../test/electron-stub";

/**
 * 快捷方式面板的折叠轨道回归
 *
 * 这个面板在**右边**，所以折叠态的锚点是「离面板右缘 8px」而不是左缘：
 * 折叠态用固定右内边距（PANEL_COLLAPSED_BUTTON_INSET）+ justify-end，
 * 展开态用 padding-right 8px，两态按钮落在同一个 x 上。
 *
 * 固定锚定而不是居中：居中在「轨道不画边框、内容盒是完整 48px」时恰好也是
 * 8px、看着等价，但它把按钮位置绑在这个前提上 —— 轨道一旦改回真边框
 * （内容盒 47px）就变成 7.5px 的小数偏移；而且宽度过渡期间轨道还是宽的，
 * 居中会把按钮摆到轨道中线而不是钉在锚点上。
 */

const COLLAPSED_KEY = "qnote-shortcut-collapsed";

const SHORTCUTS = [
  { id: 1, kind: "url", target: "https://example.com", title: "示例站点", sort_order: 0 },
  { id: 2, kind: "folder", target: "D:\\work", title: "工作目录", sort_order: 1 },
];

function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

async function flushPromises() {
  await act(async () => {
    // 把 load() 与图标解析的 promise 链都跑完
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });
}

async function renderPanel() {
  window.electron = createElectronStub({
    shortcutList: vi.fn().mockResolvedValue(SHORTCUTS),
    getShellContextMenuStatus: vi
      .fn()
      .mockResolvedValue({ supported: true, enabled: false, valid: false }),
    // 这个订阅要返回退订函数（组件把它当 effect 的 cleanup 用）
    onShortcutsChanged: vi.fn(() => () => {}),
    shortcutResolveIcon: vi.fn().mockResolvedValue(null),
  });

  const utils = render(<ShortcutPanel />);
  await flushPromises();
  return utils;
}

function getAside(): HTMLElement {
  return document.querySelector("aside") as HTMLElement;
}

describe("快捷方式面板（ShortcutPanel）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("折叠态", () => {
    beforeEach(() => {
      window.localStorage.setItem(COLLAPSED_KEY, "true");
    });

    it("轨道宽度等于 SHORTCUT_PANEL_COLLAPSED_WIDTH", async () => {
      await renderPanel();

      expect(getAside().style.width).toBe(`${SHORTCUT_PANEL_COLLAPSED_WIDTH}px`);
      expect(SHORTCUT_PANEL_COLLAPSED_WIDTH).toBe(48);
    });

    it("分隔线用内阴影画，不画边框（边框会占掉 1px 内容盒）", async () => {
      await renderPanel();

      const aside = getAside();
      expect(aside.style.boxShadow).toContain("inset");
      const tokens = classTokens(aside);
      expect(tokens).not.toContain("border-l");
      expect(tokens).not.toContain("border-r");
      expect(tokens).not.toContain("border");
    });

    it("渲染两个可点元素：32×32 箭头按钮 + 竖排标签", async () => {
      await renderPanel();

      // 箭头按钮叫「展开快捷方式」，竖排标签叫「展开快捷方式面板（N 项）」——
      // 两个名称必须能区分开，否则读屏会听到两次同一个名字
      const arrow = screen.getByRole("button", { name: "展开快捷方式" });
      expect(classTokens(arrow)).toContain("h-8");
      expect(classTokens(arrow)).toContain("w-8");

      const label = screen.getByRole("button", { name: /展开快捷方式面板/ });
      expect(label).not.toBe(arrow);

      const vertical = Array.from(label.querySelectorAll("span")).find(
        (s) => s.style.writingMode === "vertical-rl"
      );
      expect(vertical?.textContent).toBe("快捷方式");
    });

    it("箭头固定锚在轨道右缘 8px，左右留白都是 8px", async () => {
      await renderPanel();

      // 锚点：离面板右缘 8px，和展开态那个收起按钮同一个 x
      const arrowWrapper = getAside().firstElementChild as HTMLElement;
      expect(arrowWrapper.style.paddingRight).toBe(`${PANEL_COLLAPSED_BUTTON_INSET}px`);
      expect(classTokens(arrowWrapper)).toContain("justify-end");
      // 不用居中：居中把按钮位置绑在「轨道不画边框」这个前提上，
      // 而且宽度过渡期间轨道还是宽的，居中会摆到轨道中线而不是锚点
      expect(classTokens(arrowWrapper)).not.toContain("justify-center");

      // 轨道 48 = 左留白 + 按钮 32 + 右内边距 8 → 左留白也是 8
      const leftInset =
        SHORTCUT_PANEL_COLLAPSED_WIDTH -
        PANEL_COLLAPSED_BUTTON_SIZE -
        PANEL_COLLAPSED_BUTTON_INSET;
      expect(leftInset).toBe(PANEL_COLLAPSED_BUTTON_INSET);
    });

    it("竖排标签留出底边距，focus 描边下边不被轨道裁掉", async () => {
      await renderPanel();

      // 竖排标签是 flex-1，会一直撑到轨道底部。不留底边距的话，
      // focus 描边往下的那 1px 会落到轨道外面被裁掉，焦点框缺一条底边
      // （实测底边余量是 -1px）。
      // 内缩走共享常量 PANEL_RAIL_LABEL_INSET，不是写死的类名。
      const label = screen.getByRole("button", { name: /展开快捷方式面板/ });
      expect(label.style.marginBottom).toBe(`${PANEL_RAIL_LABEL_INSET}px`);
      expect(label.style.marginLeft).toBe(`${PANEL_RAIL_LABEL_INSET}px`);
      expect(label.style.marginRight).toBe(`${PANEL_RAIL_LABEL_INSET}px`);

      // 描边外扩 1px 后离底边仍余 3px，四边完整。
      // 这个标签是原生 <button>，没有 focus-visible:ring 类，走的是浏览器
      // 默认 outline（Chromium 约 1px）—— 基类改 ring-2 对它没有影响。
      expect(PANEL_RAIL_LABEL_INSET - 1).toBeGreaterThanOrEqual(2);
    });

    it("点箭头按钮能展开面板", async () => {
      const user = userEvent.setup();
      await renderPanel();

      const arrow = screen.getByRole("button", { name: "展开快捷方式" });
      await user.click(arrow);

      expect(getAside().style.width).toBe(`${SHORTCUT_PANEL_WIDTH}px`);
      expect(screen.getByRole("button", { name: "收起快捷方式" })).toBeInTheDocument();
    });

    it("点竖排标签也能展开面板", async () => {
      const user = userEvent.setup();
      await renderPanel();

      const label = screen.getByRole("button", { name: /展开快捷方式面板/ });
      await user.click(label);

      expect(getAside().style.width).toBe(`${SHORTCUT_PANEL_WIDTH}px`);
      expect(screen.getByRole("button", { name: "收起快捷方式" })).toBeInTheDocument();
    });
  });

  describe("展开态", () => {
    it("头部左右内边距等于 PANEL_HEADER_PADDING_X（收起按钮离右缘 8px）", async () => {
      await renderPanel();

      const header = getAside().firstElementChild as HTMLElement;
      expect(header.style.paddingLeft).toBe(`${PANEL_HEADER_PADDING_X}px`);
      expect(header.style.paddingRight).toBe(`${PANEL_HEADER_PADDING_X}px`);
    });

    it("头部三个按钮都是 32×32", async () => {
      await renderPanel();

      const header = getAside().firstElementChild as HTMLElement;
      const buttons = Array.from(header.querySelectorAll("button"));
      expect(buttons).toHaveLength(3);

      for (const button of buttons) {
        const tokens = classTokens(button);
        expect(tokens).toContain("h-8");
        expect(tokens).toContain("w-8");
        expect(tokens).not.toContain("h-9");
        expect(tokens).not.toContain("w-9");
      }
    });

    it("三个头部按钮分别管添加、设置、收起", async () => {
      await renderPanel();

      expect(screen.getByRole("button", { name: "添加快捷方式" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "快捷方式设置" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "收起快捷方式" })).toBeInTheDocument();
    });

    it("点收起按钮回到折叠轨道", async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByRole("button", { name: "收起快捷方式" }));

      expect(getAside().style.width).toBe(`${SHORTCUT_PANEL_COLLAPSED_WIDTH}px`);
      // 折叠态两个可点元素：箭头 + 竖排标签，名称各不相同
      expect(screen.getByRole("button", { name: "展开快捷方式" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /展开快捷方式面板/ })).toBeInTheDocument();
    });
  });

  describe("状态持久化", () => {
    it("折叠状态写进 localStorage 的既有 key", async () => {
      const user = userEvent.setup();
      await renderPanel();

      expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("false");

      await user.click(screen.getByRole("button", { name: "收起快捷方式" }));

      expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("true");
    });

    it("重新挂载后按 localStorage 恢复折叠状态", async () => {
      const user = userEvent.setup();
      const first = await renderPanel();

      await user.click(screen.getByRole("button", { name: "收起快捷方式" }));
      first.unmount();

      await renderPanel();

      expect(getAside().style.width).toBe(`${SHORTCUT_PANEL_COLLAPSED_WIDTH}px`);
    });
  });
});
