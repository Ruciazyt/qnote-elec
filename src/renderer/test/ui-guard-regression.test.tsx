import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DESTRUCTIVE_DIALOGS,
  type DestructiveDialogSpec,
} from "./ui-guard-baseline";
import {
  diffViolations,
  findBrandTextOnBrand,
  findDestructiveDialogIssues,
  findHiddenFocusables,
  findThinFocusRings,
  makeSource,
} from "./ui-guards";
import { RemoveProjectDialog } from "../components/apps/RemoveProjectDialog";

/**
 * UI 守卫的回归 —— 「修复落地之后，守卫还拦得住」
 *
 * ui-guards.test.ts 那半证明的是「检测器抓得住构造出来的坏例子」。
 * 这一半补的是另一件事：**基线清空之后**守卫还拦不拦得住。
 *
 * 背景：四类可访问性修复正在各域并行落地 ——
 *   1. 焦点环厚度（ui 基类 5 个文件里的 ring-1）
 *   2. 品牌色当文字（bg-primary/N 底上用 text-primary）
 *   3. 隐藏控件在焦点序（P0-3，8 处）
 *   4. 破坏性确认框点名（P0-4，3 处）
 * 修好后基线条目要删掉 —— 基线一旦空了，守卫不能变成「什么都不报」的安全网。
 *
 * 所以这里的每条断言都是同一个形状：
 *   拿**真实文件名**造一个「有人把代码改回去」的场景
 *   → 跑检测器 → 走 diffViolations 且基线为空
 *   → 断言它进了 added（也就是会被拦下）
 *
 * 文件名用真的，是为了让签名对得上：守卫按「文件|类型」记签名，
 * 造出同文件同签名的坏例子，才等于「这一处被改回去了」。
 *
 * ## 为什么不遍历基线条目
 *
 * 基线是「已查出来、还没改」的那批，改完就会清空。若用 `for (const sig of
 * Object.keys(BASELINE))` 逐条验证，基线清空之后循环体一次都不执行，
 * 用例变成恒真 —— 恰好在最需要它的时候失效。
 * 所以下面用的是**写死的清单**（与基线当前内容一致，但独立于基线），
 * 基线清空后这些断言依然有效。
 */

/* ============================================================
 * 清单：与当前基线一致，但写死在这里，不依赖基线文件
 * ============================================================ */

/** ui 基类里的 1px 焦点环：文件 → 该文件里的违规 token */
const THIN_RING_CASES: Array<[string, string]> = [
  ["components/ui/calendar.tsx", "focus-visible:ring-1"],
  ["components/ui/input.tsx", "focus-visible:ring-1"],
  ["components/ui/select.tsx", "focus:ring-1"],
  ["components/ui/textarea.tsx", "focus-visible:ring-1"],
  ["components/ui/toast.tsx", "focus:ring-1"],
];

/**
 * 品牌色底 + 品牌字：文件 → 底纹 token、文字 token
 *
 * ⚠️ 底纹与文字必须**分开存**，不能存成 "bg-primary/10 text-primary" 一整串。
 * 守卫除了扫 JSX 上的 className，还会扫**独立的字符串字面量**（settings-card
 * 那类常量表就是这种写法）—— 一整串切开后是「底纹 token + 文字 token」两个独立
 * token，正好构成违规，于是这个文件自己成了新增违规，把
 * ui-guards.test.ts 的「没有新增品牌色组合」那条弄红。
 * 分开存之后每个字面量单独判定都缺一半，不构成违规；运行时再拼回去。
 */
const BRAND_TEXT_CASES: Array<[string, string, string]> = [
  ["components/core/settings-card.tsx", "bg-primary/10", "text-primary"],
  ["components/core/settings.tsx", "bg-primary/10", "text-primary"],
  ["components/core/UpdateCard.tsx", "bg-primary/10", "text-primary"],
  ["components/shortcut/AddShortcutDialog.tsx", "bg-primary/[0.08]", "text-primary"],
  ["components/shortcut/ShortcutPanel.tsx", "bg-primary/10", "text-primary"],
  ["components/shortcut/ShortcutPanel.tsx", "bg-primary/15", "text-primary"],
  ["components/todo/TodoList.tsx", "bg-primary/5", "text-primary"],
  ["pages/HomePage.tsx", "bg-primary/10", "text-primary"],
  ["components/shortcut/AddShortcutDialog.tsx", "hover:bg-primary/[0.08]", "text-primary"],
  ["components/todo/TodoList.tsx", "hover:bg-primary/10", "text-primary"],
  ["pages/HomePage.tsx", "hover:bg-primary/15", "text-primary"],
];

/** 被视觉藏起来的可聚焦元素：文件 */
const HIDDEN_FOCUSABLE_FILES = [
  "components/apps/AppProjectHeader.tsx",
  "components/browser/BookmarkList.tsx",
  "components/todo/TodoEditDialog.tsx",
  "pages/BrowserPage.tsx",
  "pages/SkillsPage.tsx",
];

/** 破坏性确认框：文件 → 目标名标识符 */
const DESTRUCTIVE_CASES: Array<[string, string]> = [
  ["components/apps/RemoveProjectDialog.tsx", "name"],
];

/** 造一个「按钮被 opacity-0 藏起来」的坏例子 */
function hiddenFocusableSource(_file: string): string {
  return `export function X() { return (
     <div className="opacity-0">
       <button>删</button>
     </div>
   ); }`;
}

/** 造一个「描述里没有点名目标」的坏例子 */
function unnamedDescriptionSource(_file: string): string {
  return `export function X() {
     return (
       <DialogContent>
         <DialogDescription>移除后不再出现在列表里。</DialogDescription>
       </DialogContent>
     );
   }`;
}

/** 从清单里取出破坏性确认框的 spec（带 targetProp） */
function specOf(file: string, targetProp: string): DestructiveDialogSpec {
  const found = DESTRUCTIVE_DIALOGS.find((d) => d.file === file);
  if (found) return found;
  return { file, targetProp, label: "测试" };
}

/* ============================================================
 * 一、焦点环厚度
 * ============================================================ */

describe("焦点环厚度：基线清空后守卫仍然拦得住", () => {
  it("ui 基类里再出现 1px 焦点环，会进 added 被拦下", () => {
    for (const [file, token] of THIN_RING_CASES) {
      const bad = makeSource(file, `const c = "${token}";`);
      const { added } = diffViolations(findThinFocusRings([bad]), {});
      expect(
        added.map((v) => v.signature),
        `${file} 里的 ${token} 应当被拦下`
      ).toContain(`${file}|${token}`);
    }
  });

  it("基线里的每一项，清空基线后都还能被造出来（签名对得上）", () => {
    // 防的是「基线里写了一个检测器其实抓不到的签名」——
    // 那样基线清空后守卫就漏了那处。
    for (const [file, token] of THIN_RING_CASES) {
      const bad = makeSource(file, `const c = "${token}";`);
      const found = findThinFocusRings([bad]).map((v) => v.signature);
      expect(found, `${file}|${token} 应当是检测器能产出的签名`).toContain(
        `${file}|${token}`
      );
    }
  });

  it("2px 的环不会误报 —— 改回 ring-2 仍然是合规的", () => {
    const ok = makeSource("components/ui/input.tsx", 'const c = "focus-visible:ring-2";');
    const { added } = diffViolations(findThinFocusRings([ok]), {});
    expect(added).toEqual([]);
  });
});

/* ============================================================
 * 二、品牌色当文字
 * ============================================================ */

describe("品牌色当文字：基线清空后守卫仍然拦得住", () => {
  it("每一处「品牌底纹 + 品牌字」，清空基线后都进 added", () => {
    for (const [file, bg, text] of BRAND_TEXT_CASES) {
      const combo = `${bg} ${text}`;
      const bad = makeSource(
        file,
        `export function X() { return (<span className="${bg} ${text}">已配置</span>); }`
      );
      const { added } = diffViolations(findBrandTextOnBrand([bad]), {});
      expect(
        added.map((v) => v.signature),
        `${file} 里的 ${combo} 应当被拦下`
      ).toContain(`${file}|${combo}`);
    }
  });

  it("判据是两维：底纹档 × 字色", () => {
    // 同一档底纹，字色是品牌色就红
    const brandText = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/10 text-primary">已配置</span>); }`
    );
    // 同一档底纹，字色是深档 primary-strong 就放行
    const strongText = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/10 text-primary-strong">已配置</span>); }`
    );

    expect(findBrandTextOnBrand([brandText])).toHaveLength(1);
    expect(findBrandTextOnBrand([strongText])).toEqual([]);
  });

  it("档位也参与判定：/15 以内的深档放行，/20 红", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/15 text-primary-strong">已配置</span>); }`
    );
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/20 text-primary-strong">已配置</span>); }`
    );

    expect(findBrandTextOnBrand([ok])).toEqual([]);
    expect(findBrandTextOnBrand([bad]).map((v) => v.kind)).toEqual([
      "brand-tint-too-deep",
    ]);
  });

  it("变体前缀都看穿：hover: / focus: / group-hover:", () => {
    for (const prefix of ["hover", "focus", "group-hover"]) {
      const bad = makeSource(
        "components/x.tsx",
        `export function X() { return (<button className="${prefix}:bg-primary/10 ${prefix}:text-primary">删</button>); }`
      );
      const found = findBrandTextOnBrand([bad]);
      expect(found.length, `${prefix}: 变体应当被抓`).toBe(1);
      expect(found[0].signature).toBe(
        `components/x.tsx|${prefix}:bg-primary/10 text-primary`
      );
    }
  });

  it("基础态的品牌字配变体态的品牌底纹，也算违规", () => {
    // 变体态里基础态的类名依然生效 —— 只盯变体自己的 token 会漏掉这一种
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<button className="text-primary hover:bg-primary/10">删</button>); }`
    );
    const found = findBrandTextOnBrand([bad]);
    expect(found).toHaveLength(1);
    expect(found[0].signature).toBe("components/x.tsx|hover:bg-primary/10 text-primary");
  });

  it("变体态只有品牌底纹、文字是普通色，放行", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<button className="hover:bg-primary/10 hover:text-foreground">删</button>); }`
    );
    expect(findBrandTextOnBrand([ok])).toEqual([]);
  });
});

/* ============================================================
 * 三、隐藏控件在焦点序
 * ============================================================ */

describe("隐藏控件：基线清空后守卫仍然拦得住", () => {
  it("每一处视觉藏起的可聚焦元素，清空基线后都进 added", () => {
    for (const file of HIDDEN_FOCUSABLE_FILES) {
      const bad = makeSource(file, hiddenFocusableSource(file));
      const { added } = diffViolations(findHiddenFocusables([bad]), {});
      expect(
        added.map((v) => v.signature),
        `${file} 里的视觉藏起应当被拦下`
      ).toContain(`${file}|视觉藏起`);
    }
  });

  it("结构性隐藏（invisible）不算违规 —— 修完之后守卫不会误伤", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (
         <div className="opacity-0 pointer-events-none invisible">
           <button>删</button>
         </div>
       ); }`
    );
    const { added } = diffViolations(findHiddenFocusables([ok]), {});
    expect(added).toEqual([]);
  });

  it("带 focus 显形规则的放行 —— 这是各域修完之后的正确形态", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (
         <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
           <button>删</button>
         </div>
       ); }`
    );
    const { added } = diffViolations(findHiddenFocusables([ok]), {});
    expect(added).toEqual([]);
  });
});

/* ============================================================
 * 四、破坏性确认框
 * ============================================================ */

describe("破坏性确认框：基线清空后守卫仍然拦得住", () => {
  it("描述不再点名目标，清空基线后进 added", () => {
    for (const [file, targetProp] of DESTRUCTIVE_CASES) {
      const spec = specOf(file, targetProp);
      const bad = makeSource(file, unnamedDescriptionSource(file));
      const { added } = diffViolations(findDestructiveDialogIssues([bad], [spec]), {});
      expect(
        added.map((v) => v.signature),
        `${file} 的描述没点名应当被拦下`
      ).toContain(`${file}|描述没点名`);
    }
  });

  it("正文不在 DialogDescription 里也会进 added", () => {
    const file = "components/apps/RemoveProjectDialog.tsx";
    const spec = specOf(file, "name");
    const bad = makeSource(
      file,
      `export function X() {
         return (
           <DialogContent>
             <p>确定要移除吗？</p>
           </DialogContent>
         );
       }`
    );
    const { added } = diffViolations(findDestructiveDialogIssues([bad], [spec]), {});
    expect(added.map((v) => v.signature)).toContain(`${file}|缺 DialogDescription`);
  });

  it("描述点了名就放行 —— 各域修完之后的正确形态", () => {
    const file = "components/apps/RemoveProjectDialog.tsx";
    const spec = specOf(file, "name");
    const ok = makeSource(
      file,
      `export function X({ name }: { name: string }) {
         return (
           <DialogContent>
             <DialogDescription>确定要移除「{name}」吗？</DialogDescription>
           </DialogContent>
         );
       }`
    );
    const { added } = diffViolations(findDestructiveDialogIssues([ok], [spec]), {});
    expect(added).toEqual([]);
  });

  it("运行时：描述节点里确实点名了目标（按 aria-describedby 找节点，不断言文案全文）", () => {
    const projectName = "我的应用";
    render(
      <RemoveProjectDialog
        open
        name={projectName}
        path="D:\\apps\\my-app"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    // 口径：读屏念的是 aria-describedby 指的那一段，不是整段文案
    const description = document.getElementById(describedBy!);
    expect(description).toBeTruthy();
    expect(description!.textContent).toContain(projectName);
  });
});
