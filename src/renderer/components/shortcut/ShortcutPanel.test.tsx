import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutPanel } from "./ShortcutPanel";
import { SHORTCUT_PANEL_COLLAPSED_WIDTH, SHORTCUT_PANEL_WIDTH } from "./types";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_BUTTON_SIZE,
  PANEL_HEADER_PADDING_X,
} from "@/components/panel/layout";
import { createElectronStub } from "../../test/electron-stub";

/**
 * 快捷方式面板的折叠轨道回归
 *
 * 这个面板在**右边**，所以折叠态的锚点是「离面板右缘 8px」而不是左缘：
 * 折叠轨用居中（轨道没画边框，内容盒就是完整的 48px），
 * 展开态用 padding-right 8px，两态按钮落在同一个 x 上。
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

    it("箭头落在轨道正中，左右留白相等", async () => {
      await renderPanel();

      const inset = (SHORTCUT_PANEL_COLLAPSED_WIDTH - PANEL_COLLAPSED_BUTTON_SIZE) / 2;
      expect(inset).toBe(PANEL_COLLAPSED_BUTTON_INSET);

      // 轨道没画边框（用内阴影画分隔线），内容盒就是完整的 48px，
      // 所以这里用居中是安全的 —— 居中不会算出 7.5px 的小数偏移
      const arrowWrapper = getAside().firstElementChild as HTMLElement;
      expect(classTokens(arrowWrapper)).toContain("justify-center");
    });

    it("竖排标签留出底边距，focus 描边下边不被轨道裁掉", async () => {
      await renderPanel();

      // 竖排标签是 flex-1，会一直撑到轨道底部。不留底边距的话，
      // focus 描边往下的那 1px 会落到轨道外面被裁掉，焦点框缺一条底边
      // （实测底边余量是 -1px）。
      const label = screen.getByRole("button", { name: /展开快捷方式面板/ });
      const tokens = classTokens(label);
      expect(tokens).toContain("mb-1");
      expect(tokens).toContain("mx-1");
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
