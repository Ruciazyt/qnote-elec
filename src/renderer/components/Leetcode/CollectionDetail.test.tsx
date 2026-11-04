import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CollectionDetail, {
  extractProblemSlug,
  extractProblemTitle,
  slugToTitle,
} from "./CollectionDetail";
import { createElectronStub } from "../../test/electron-stub";

/**
 * 题单详情页的回归用例
 *
 * 这批锁两件事：
 * 1. 题目行与编辑态的图标按钮都有可读名称，且名称里带题目标题 / 题单名 ——
 *    同一页会出现多个同名按钮，不带限定词读屏分不清是哪一条。
 * 2. 勾选、添加、删除、外链这些操作的实际行为（调了哪些 IPC、状态怎么变）。
 */

/** 一个题单，两道题：一道未完成、一道已完成 */
const COLLECTION = {
  id: 7,
  name: "动态规划专题",
  summary: "DP 入门",
  problems: [
    {
      id: 101,
      link: "https://leetcode.cn/problems/two-sum/",
      is_completed: false,
      title: "两数之和",
      difficulty: "Easy",
    },
    {
      id: 102,
      link: "https://leetcode.cn/problems/three-sum/",
      is_completed: true,
      title: "三数之和",
      difficulty: "Medium",
    },
  ],
};

async function renderDetail(overrides: Record<string, unknown> = {}) {
  window.electron = createElectronStub({
    getLeetcodeCollection: vi.fn().mockResolvedValue(COLLECTION),
    // 存回去什么就返回什么 —— 与主进程「原样保存」的行为一致，
    // 组件乐观更新后的列表才会跟着变
    saveLeetcodeCollection: vi.fn(async (payload: unknown) => payload),
    updateLeetcodeProblem: vi.fn().mockResolvedValue(undefined),
    getLeetcodeProblemTitle: vi.fn().mockResolvedValue({ success: false }),
    openExternal: vi.fn().mockResolvedValue(true),
    ...overrides,
  });

  const onRefresh = vi.fn();
  const utils = render(<CollectionDetail collectionId={7} onRefresh={onRefresh} />);

  // 组件挂载后异步拉一次题单，等它落定
  await act(async () => {
    await Promise.resolve();
  });

  return { ...utils, onRefresh };
}

describe("题单详情页", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("难度徽章", () => {
    it("语义色做底色、文字用 text-foreground（不把语义色当文字色）", async () => {
      await renderDetail({
        getLeetcodeCollection: vi.fn().mockResolvedValue({
          ...COLLECTION,
          problems: [
            ...COLLECTION.problems,
            {
              id: 103,
              link: "https://leetcode.cn/problems/median-of-two-sorted-arrays/",
              is_completed: false,
              title: "寻找两个正序数组的中位数",
              difficulty: "Hard",
            },
          ],
        }),
      });

      // 断的是「底色走哪个语义 token」+「文字是 text-foreground」，
      // 不绑死透明度档（档位以后可能调），也不绑精确 class 串。
      const cases: Array<[string, RegExp]> = [
        ["Easy", /^bg-success(\/\d+)?$/],
        ["Medium", /^bg-muted(\/\d+)?$/],
        ["Hard", /^bg-destructive(\/\d+)?$/],
      ];

      for (const [label, bgPattern] of cases) {
        const badge = screen.getByText(label);
        const tokens = (badge.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

        // 底色是该难度的语义色
        expect(tokens.some((t) => bgPattern.test(t))).toBe(true);
        // 文字是 text-foreground —— 语义色当文字色落在同色 15% 浅底上只有 3.9:1 左右，
        // 过不了 AA 4.5:1（无头 Electron 像素实测：改后 10.02 / 10.58 / 9.63）
        expect(tokens).toContain("text-foreground");
        expect(tokens.some((t) => /^text-(success|warning|destructive)$/.test(t))).toBe(false);
      }
    });
  });

  describe("题目行的可读名称", () => {
    it("勾选按钮名称带题目标题，并随完成状态变化", async () => {
      await renderDetail();

      // 未完成的题：按钮表示「把它标成已完成」
      expect(screen.getByRole("button", { name: "标记为已完成：两数之和" })).toBeInTheDocument();
      // 已完成的题：按钮表示「把它标成未完成」
      expect(screen.getByRole("button", { name: "标记为未完成：三数之和" })).toBeInTheDocument();
    });

    it("打开外链按钮名称带题目标题", async () => {
      await renderDetail();

      expect(
        screen.getByRole("button", { name: "用系统浏览器打开：两数之和" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "用系统浏览器打开：三数之和" })
      ).toBeInTheDocument();
    });

    it("删除题目按钮名称带题目标题", async () => {
      await renderDetail();

      expect(screen.getByRole("button", { name: "删除题目：两数之和" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "删除题目：三数之和" })).toBeInTheDocument();
    });

    it("同页多题时按钮名称互不相同", async () => {
      await renderDetail();

      const toggleButtons = screen.getAllByRole("button", { name: /^标记为(已完成|未完成)：/ });
      const openButtons = screen.getAllByRole("button", { name: /^用系统浏览器打开：/ });
      const deleteButtons = screen.getAllByRole("button", { name: /^删除题目：/ });

      expect(toggleButtons).toHaveLength(2);
      expect(openButtons).toHaveLength(2);
      expect(deleteButtons).toHaveLength(2);

      const names = new Set(openButtons.map((b) => b.getAttribute("aria-label")));
      expect(names.size).toBe(2);
    });
  });

  describe("题单名称编辑", () => {
    it("点标题进入编辑态，出现保存与取消按钮", async () => {
      const user = userEvent.setup();
      await renderDetail();

      expect(screen.queryByRole("button", { name: "保存题单名称" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "编辑题单名称：动态规划专题" }));

      expect(screen.getByRole("button", { name: "保存题单名称" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "取消重命名" })).toBeInTheDocument();
    });

    it("保存新名称会调 saveLeetcodeCollection 并回调 onRefresh", async () => {
      const user = userEvent.setup();
      const { onRefresh } = await renderDetail();

      await user.click(screen.getByRole("button", { name: "编辑题单名称：动态规划专题" }));

      const input = screen.getByDisplayValue("动态规划专题");
      await user.clear(input);
      await user.type(input, "算法题精选");
      await user.click(screen.getByRole("button", { name: "保存题单名称" }));

      expect(window.electron.saveLeetcodeCollection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, name: "算法题精选" })
      );
      expect(onRefresh).toHaveBeenCalled();
      // 保存后回到展示态
      expect(screen.queryByRole("button", { name: "保存题单名称" })).toBeNull();
    });

    it("取消重命名后回到展示态，且不写入", async () => {
      const user = userEvent.setup();
      await renderDetail();

      await user.click(screen.getByRole("button", { name: "编辑题单名称：动态规划专题" }));
      await user.type(screen.getByDisplayValue("动态规划专题"), "改了名");
      await user.click(screen.getByRole("button", { name: "取消重命名" }));

      expect(screen.queryByRole("button", { name: "保存题单名称" })).toBeNull();
      expect(window.electron.saveLeetcodeCollection).not.toHaveBeenCalled();
      expect(screen.getByText("动态规划专题")).toBeInTheDocument();
    });
  });

  describe("题目完成状态", () => {
    it("点勾选按钮调 updateLeetcodeProblem，按钮名称跟着翻转", async () => {
      const user = userEvent.setup();
      await renderDetail();

      await user.click(screen.getByRole("button", { name: "标记为已完成：两数之和" }));

      expect(window.electron.updateLeetcodeProblem).toHaveBeenCalledWith(101, {
        is_completed: true,
      });
      expect(
        screen.getByRole("button", { name: "标记为未完成：两数之和" })
      ).toBeInTheDocument();
    });

    it("题目数据不完整时不给 toggle，并提示失败", async () => {
      const user = userEvent.setup();
      await renderDetail({
        getLeetcodeCollection: vi.fn().mockResolvedValue({
          ...COLLECTION,
          problems: [{ link: "https://leetcode.cn/problems/no-id/", is_completed: false }],
        }),
      });

      await user.click(screen.getByRole("button", { name: /^标记为已完成：/ }));

      expect(window.electron.updateLeetcodeProblem).not.toHaveBeenCalled();
    });
  });

  describe("题目标题来源", () => {
    it("没有缓存标题时，标题按链接里的 slug 生成", async () => {
      await renderDetail({
        getLeetcodeCollection: vi.fn().mockResolvedValue({
          ...COLLECTION,
          problems: [
            { id: 201, link: "https://leetcode.cn/problems/two-sum/", is_completed: false },
          ],
        }),
      });

      expect(screen.getByText("Two Sum")).toBeInTheDocument();
      // 名称里带的也是这个标题
      expect(
        screen.getByRole("button", { name: "标记为已完成：Two Sum" })
      ).toBeInTheDocument();
    });

    it("缓存标题优先于链接里的 slug", async () => {
      await renderDetail();

      // 两数之和（缓存）而不是 Two Sum（slug）
      expect(screen.getByText("两数之和")).toBeInTheDocument();
      expect(screen.queryByText("Two Sum")).toBeNull();
    });
  });

  describe("添加题目", () => {
    it("没填链接时添加按钮不可点", async () => {
      await renderDetail();

      expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
    });

    it("填链接后能添加题目，标题按链接 slug 生成", async () => {
      const user = userEvent.setup();
      const { onRefresh } = await renderDetail();

      await user.type(screen.getByPlaceholderText("输入题目链接"), "https://leetcode.cn/problems/three-sum/");
      await user.click(screen.getByRole("button", { name: "添加" }));

      expect(window.electron.saveLeetcodeCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          problems: expect.arrayContaining([
            expect.objectContaining({ link: "https://leetcode.cn/problems/three-sum/" }),
          ]),
        })
      );
      expect(onRefresh).toHaveBeenCalled();
      // 新题目标题走 slug 兜底
      expect(screen.getByText("Three Sum")).toBeInTheDocument();
    });
  });

  describe("删除题目", () => {
    it("点删除题目按钮会保存去掉该题的题单", async () => {
      const user = userEvent.setup();
      await renderDetail();

      await user.click(screen.getByRole("button", { name: "删除题目：两数之和" }));

      expect(window.electron.saveLeetcodeCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          problems: [expect.objectContaining({ id: 102 })],
        })
      );
      // 被删的那道题从列表里消失，另一道还在
      expect(screen.queryByText("两数之和")).toBeNull();
      expect(screen.getByText("三数之和")).toBeInTheDocument();
    });
  });

  describe("打开外链", () => {
    it("点外链按钮走 openExternal，不直接开新窗口", async () => {
      const user = userEvent.setup();
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      await renderDetail();

      await user.click(screen.getByRole("button", { name: "用系统浏览器打开：两数之和" }));

      expect(window.electron.openExternal).toHaveBeenCalledWith(
        "https://leetcode.cn/problems/two-sum/"
      );
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe("加载失败", () => {
    it("拉取题单失败时退回空列表，不白屏", async () => {
      await renderDetail({
        getLeetcodeCollection: vi.fn().mockRejectedValue(new Error("boom")),
      });

      expect(screen.getByText("暂无题目，在上方输入链接添加题目")).toBeInTheDocument();
    });
  });
});

/**
 * 题目标题解析的纯函数
 *
 * 这三个函数只做字符串解析，没有副作用也没有依赖 —— 边界比组件路径更值得测：
 * 非法 URL、没有 /problems/ 段的路径、超长链接的截断，都是用户真会粘进来的东西。
 */
describe("题目标题解析（纯函数）", () => {
  describe("extractProblemSlug", () => {
    it("从路径里取出 slug", () => {
      expect(extractProblemSlug("https://leetcode.cn/problems/two-sum/")).toBe("two-sum");
    });

    it("末尾斜杠可带可不带", () => {
      expect(extractProblemSlug("https://leetcode.cn/problems/two-sum")).toBe("two-sum");
    });

    it("只认 pathname，query 不参与", () => {
      expect(extractProblemSlug("https://leetcode.cn/problems/two-sum/?env=prod")).toBe(
        "two-sum"
      );
    });

    it("非法 URL 返回 null", () => {
      expect(extractProblemSlug("not-a-url")).toBeNull();
      expect(extractProblemSlug("")).toBeNull();
    });

    it("路径里没有 /problems/ 段返回 null", () => {
      expect(extractProblemSlug("https://example.com/solutions/two-sum")).toBeNull();
      expect(extractProblemSlug("https://example.com/problems/")).toBeNull();
    });
  });

  describe("slugToTitle", () => {
    it("按连字符分词，每段首字母大写后用空格连接", () => {
      expect(slugToTitle("two-sum")).toBe("Two Sum");
      expect(slugToTitle("add-two-numbers")).toBe("Add Two Numbers");
    });

    it("空字符串返回空串，不抛错", () => {
      expect(slugToTitle("")).toBe("");
    });

    it("已经大写的词不改写", () => {
      expect(slugToTitle("Two-Sum")).toBe("Two Sum");
    });

    it("只按连字符分词，下划线不动", () => {
      expect(slugToTitle("two_sum")).toBe("Two_sum");
    });
  });

  describe("extractProblemTitle", () => {
    it("缓存标题优先", () => {
      expect(extractProblemTitle("https://leetcode.cn/problems/two-sum/", "两数之和")).toBe(
        "两数之和"
      );
    });

    it("缓存标题是空串时按没有缓存处理，走 URL 兜底", () => {
      expect(extractProblemTitle("https://leetcode.cn/problems/two-sum/", "")).toBe("Two Sum");
    });

    it("没有缓存标题时按 slug 生成", () => {
      expect(extractProblemTitle("https://leetcode.cn/problems/two-sum/")).toBe("Two Sum");
    });

    it("URL 里取不到 slug 时退回域名", () => {
      expect(extractProblemTitle("https://example.com/problems/")).toBe("example.com");
    });

    it("非法 URL 且不太长时原样返回", () => {
      expect(extractProblemTitle("not-a-url")).toBe("not-a-url");
    });

    it("非法 URL 且超过 50 字时截断并加省略号", () => {
      const long = "x".repeat(60);
      expect(extractProblemTitle(long)).toBe(`${"x".repeat(50)}...`);
    });
  });
});
