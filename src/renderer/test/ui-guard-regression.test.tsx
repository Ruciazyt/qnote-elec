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
import { RemovePluginDialog } from "../pages/plugin/RemovePluginDialog";



const THIN_RING_CASES: Array<[string, string]> = [
  ["components/ui/calendar.tsx", "focus-visible:ring-1"],
  ["components/ui/input.tsx", "focus-visible:ring-1"],
  ["components/ui/select.tsx", "focus:ring-1"],
  ["components/ui/textarea.tsx", "focus-visible:ring-1"],
  ["components/ui/toast.tsx", "focus:ring-1"],
];

const BRAND_TEXT_CASES: Array<[string, string, string]> = [
  ["pages/settings/settings-card.tsx", "bg-primary/10", "text-primary"],
  ["pages/settings/SettingsPage.tsx", "bg-primary/10", "text-primary"],
  ["pages/settings/UpdateCard.tsx", "bg-primary/10", "text-primary"],
  ["pages/home/shortcut/AddShortcutDialog.tsx", "bg-primary/[0.08]", "text-primary"],
  ["pages/home/shortcut/ShortcutPanel.tsx", "bg-primary/10", "text-primary"],
  ["pages/home/shortcut/ShortcutPanel.tsx", "bg-primary/15", "text-primary"],
  ["pages/todo/TodoList.tsx", "bg-primary/5", "text-primary"],
  ["pages/home/HomePage.tsx", "bg-primary/10", "text-primary"],
  ["pages/home/shortcut/AddShortcutDialog.tsx", "hover:bg-primary/[0.08]", "text-primary"],
  ["pages/todo/TodoList.tsx", "hover:bg-primary/10", "text-primary"],
  ["pages/home/HomePage.tsx", "hover:bg-primary/15", "text-primary"],
];

const HIDDEN_FOCUSABLE_FILES = [
  "pages/plugin/PluginHeader.tsx",
  "pages/browser/BookmarkList.tsx",
  "pages/todo/TodoEditDialog.tsx",
  "pages/browser/BrowserPage.tsx",
  "pages/skills/SkillsPage.tsx",
];

const DESTRUCTIVE_CASES: Array<[string, string]> = [
  ["pages/plugin/RemovePluginDialog.tsx", "name"],
];

function hiddenFocusableSource(_file: string): string {
  return `export function X() { return (
     <div className="opacity-0">
       <button>删</button>
     </div>
   ); }`;
}

function unnamedDescriptionSource(_file: string): string {
  return `export function X() {
     return (
       <DialogContent>
         <DialogDescription>移除后不再出现在列表里。</DialogDescription>
       </DialogContent>
     );
   }`;
}

function specOf(file: string, targetProp: string): DestructiveDialogSpec {
  const found = DESTRUCTIVE_DIALOGS.find((d) => d.file === file);
  if (found) return found;
  return { file, targetProp, label: "测试" };
}


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
    const brandText = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/10 text-primary">已配置</span>); }`
    );
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
    const file = "pages/plugin/RemovePluginDialog.tsx";
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
    const file = "pages/plugin/RemovePluginDialog.tsx";
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
      <RemovePluginDialog
        open
        name={projectName}
        path="D:\\plugins\\my-plugin"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const description = document.getElementById(describedBy!);
    expect(description).toBeTruthy();
    expect(description!.textContent).toContain(projectName);
  });
});
