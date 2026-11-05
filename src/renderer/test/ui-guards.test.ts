import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_TEXT_BASELINE,
  DESTRUCTIVE_DIALOG_BASELINE,
  DESTRUCTIVE_DIALOGS,
  HIDDEN_FOCUSABLE_BASELINE,
  THIN_FOCUS_RING_BASELINE,
} from "./ui-guard-baseline";
import {
  diffViolations,
  findBrandTextOnBrand,
  findDestructiveDialogIssues,
  findHiddenFocusables,
  findThinFocusRings,
  makeSource,
  readRendererSources,
} from "./ui-guards";

/**
 * UI 守卫：焦点环厚度、隐藏控件、破坏性确认框、品牌色文字
 *
 * 每条守卫都是「基线 + 变异输入」两半：
 *   - 基线：当前已知的违规项都在名单里，名单外新出现的立刻红
 *   - 变异：拿构造出来的坏例子喂给检测器，证明它真会抓（不然守卫是假的安全网）
 *
 * 基线是「已查出来、还没改」的那批。改好之后基线会多出「已修复」条目 ——
 * 那只是提醒（打印出来），不拦构建：仓库要一直是绿的，
 * 否则 auto-build.yml 每次推 master 都会被卡住。
 */

const RENDERER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = readRendererSources(RENDERER_ROOT);

/** 已修复的条目只提醒，不拦构建 */
function reportFixed(label: string, fixed: string[]): void {
  if (!fixed.length) return;
  console.warn(
    `[ui-guard] ${label}：已修复 ${fixed.length} 处，请从基线里删掉 ——\n  ${fixed.join("\n  ")}`
  );
}

describe("焦点环厚度", () => {
  const current = findThinFocusRings(sources);

  it("ui 基类里没有新增的 1px 焦点环", () => {
    const { added } = diffViolations(current, THIN_FOCUS_RING_BASELINE);
    expect(added.map((v) => v.signature)).toEqual([]);
  });

  it("已修复的条目会提醒删基线（不拦构建）", () => {
    const { fixed } = diffViolations(current, THIN_FOCUS_RING_BASELINE);
    reportFixed("焦点环", fixed);
    expect(Array.isArray(fixed)).toBe(true);
  });

  it("button 基类的 2px 焦点环是基线，不算违规", () => {
    const button = makeSource("components/ui/button.tsx", 'const c = "focus-visible:ring-2";');
    expect(findThinFocusRings([button])).toEqual([]);
  });

  it("变异输入：ring-1 会被抓出来", () => {
    const bad = makeSource("components/ui/input.tsx", 'const c = "focus-visible:ring-1";');
    expect(findThinFocusRings([bad]).map((v) => v.signature)).toEqual([
      "components/ui/input.tsx|focus-visible:ring-1",
    ]);
  });

  it("变异输入：非焦点的 ring-1（描边）不算违规", () => {
    const ok = makeSource("components/ui/card.tsx", 'const c = "ring-1 ring-border";');
    expect(findThinFocusRings([ok])).toEqual([]);
  });
});

describe("隐藏控件", () => {
  const current = findHiddenFocusables(sources);

  it("没有新增被藏起来的可聚焦元素", () => {
    const { added } = diffViolations(current, HIDDEN_FOCUSABLE_BASELINE);
    expect(added.map((v) => v.signature)).toEqual([]);
  });

  it("已修复的条目会提醒删基线（不拦构建）", () => {
    const { fixed } = diffViolations(current, HIDDEN_FOCUSABLE_BASELINE);
    reportFixed("隐藏控件", fixed);
    expect(Array.isArray(fixed)).toBe(true);
  });

  it("变异输入：opacity-0 里的按钮会被抓出来", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<div className="opacity-0 group-hover:opacity-100"><button>删</button></div>); }`
    );
    expect(findHiddenFocusables([bad]).length).toBe(1);
  });

  it("变异输入：带 focus 显形规则的放行", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100"><button>删</button></div>); }`
    );
    expect(findHiddenFocusables([ok])).toEqual([]);
  });

  it("变异输入：结构性隐藏（invisible）不算违规", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<div className="opacity-0 pointer-events-none invisible"><button>删</button></div>); }`
    );
    expect(findHiddenFocusables([ok])).toEqual([]);
  });

  it("变异输入：字色全透明（text-muted-foreground/0）同样算藏起来", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<button className="text-muted-foreground/0 group-hover:text-muted-foreground/70">删</button>); }`
    );
    expect(findHiddenFocusables([bad]).map((v) => v.signature)).toEqual([
      "components/x.tsx|视觉藏起",
    ]);
  });

  it("变异输入：一个包装器藏住两个按钮，只算一处", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (
         <div className="opacity-0 group-hover:opacity-100">
           <button>编辑</button>
           <button>删除</button>
         </div>
       ); }`
    );
    expect(findHiddenFocusables([bad]).length).toBe(1);
  });

  it("变异输入：pointer-events-auto 能抵消祖先的 pointer-events-none", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (
         <div className="pointer-events-none">
           <button className="pointer-events-auto">关</button>
         </div>
       ); }`
    );
    expect(findHiddenFocusables([ok])).toEqual([]);
  });

  it("变异输入：悬停能显形的（group-hover:pointer-events-auto）不算鼠标点不到", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (
         <div className="pointer-events-none group-hover:pointer-events-auto">
           <button>关</button>
         </div>
       ); }`
    );
    const found = findHiddenFocusables([bad]);
    expect(found.filter((v) => v.signature.endsWith("鼠标点不到"))).toEqual([]);
  });
});

describe("破坏性确认框", () => {
  const current = findDestructiveDialogIssues(sources, DESTRUCTIVE_DIALOGS);

  it("没有新增描述问题", () => {
    const { added } = diffViolations(current, DESTRUCTIVE_DIALOG_BASELINE);
    expect(added.map((v) => v.signature)).toEqual([]);
  });

  it("已修复的条目会提醒删基线（不拦构建）", () => {
    const { fixed } = diffViolations(current, DESTRUCTIVE_DIALOG_BASELINE);
    reportFixed("破坏性确认框", fixed);
    expect(Array.isArray(fixed)).toBe(true);
  });

  it("变异输入：正文不在 DialogDescription 里会被抓出来", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() {
         return (
           <DialogContent>
             <p>确定要删掉吗？</p>
           </DialogContent>
         );
       }`
    );
    const found = findDestructiveDialogIssues([bad], [
      { file: "components/x.tsx", targetProp: null, label: "测试" },
    ]);
    expect(found.map((v) => v.signature)).toEqual(["components/x.tsx|缺 DialogDescription"]);
  });

  it("变异输入：描述没点名目标会被抓出来", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X({ name }: { name: string }) {
         return (
           <DialogContent>
             <DialogDescription>移除后不再出现在列表里。</DialogDescription>
           </DialogContent>
         );
       }`
    );
    const found = findDestructiveDialogIssues([bad], [
      { file: "components/x.tsx", targetProp: "name", label: "测试" },
    ]);
    expect(found.map((v) => v.signature)).toEqual(["components/x.tsx|描述没点名"]);
  });

  it("变异输入：描述点了名就放行", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X({ name }: { name: string }) {
         return (
           <DialogContent>
             <DialogDescription>移除「{name}」后不再出现在列表里。</DialogDescription>
           </DialogContent>
         );
       }`
    );
    const found = findDestructiveDialogIssues([ok], [
      { file: "components/x.tsx", targetProp: "name", label: "测试" },
    ]);
    expect(found).toEqual([]);
  });
});

describe("品牌色当文字", () => {
  const current = findBrandTextOnBrand(sources);

  it("没有新增「品牌色底 + 品牌色字」的组合", () => {
    const { added } = diffViolations(current, BRAND_TEXT_BASELINE);
    expect(added.map((v) => v.signature)).toEqual([]);
  });

  it("已修复的条目会提醒删基线（不拦构建）", () => {
    const { fixed } = diffViolations(current, BRAND_TEXT_BASELINE);
    reportFixed("品牌色", fixed);
    expect(Array.isArray(fixed)).toBe(true);
  });

  it("变异输入：bg-primary/10 配 text-primary 会被抓出来", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/10 text-primary">已配置</span>); }`
    );
    expect(findBrandTextOnBrand([bad]).length).toBe(1);
  });

  it("变异输入：text-primary-strong 放行", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/10 text-primary-strong">已配置</span>); }`
    );
    expect(findBrandTextOnBrand([ok])).toEqual([]);
  });

  it("变异输入：文字压品牌色主按钮（text-primary-foreground）不算违规", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary text-primary-foreground">已配置</span>); }`
    );
    expect(findBrandTextOnBrand([ok])).toEqual([]);
  });

  it("变异输入：悬停态的品牌底纹 + 品牌字会被抓出来", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<button className="hover:bg-primary/10 hover:text-primary">删</button>); }`
    );
    const found = findBrandTextOnBrand([bad]);
    expect(found.map((v) => v.signature)).toEqual([
      "components/x.tsx|hover:bg-primary/10 text-primary",
    ]);
  });

  it("变异输入：悬停态只有品牌底纹、文字是普通色，放行", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<button className="hover:bg-primary/10 hover:text-foreground">删</button>); }`
    );
    expect(findBrandTextOnBrand([ok])).toEqual([]);
  });

  it("变异输入：品牌底纹超过 /15（禁用档）会被抓出来", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/20 text-primary">已配置</span>); }`
    );
    const found = findBrandTextOnBrand([bad]);
    expect(found.length).toBe(1);
    expect(found[0].kind).toBe("brand-tint-too-deep");
  });

  it("变异输入：禁用档（/20）配 text-primary-strong 也会红", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/20 text-primary-strong">已配置</span>); }`
    );
    const found = findBrandTextOnBrand([bad]);
    expect(found.length).toBe(1);
    expect(found[0].kind).toBe("brand-tint-too-deep");
  });

  it("变异输入：primary-strong 配 /15 放行（上限之内）", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/15 text-primary-strong">已配置</span>); }`
    );
    expect(findBrandTextOnBrand([ok])).toEqual([]);
  });

  it("变异输入：实心 text-primary 配 /5 也红（任何品牌底纹都不过线）", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/5 text-primary">已配置</span>); }`
    );
    expect(findBrandTextOnBrand([bad]).length).toBe(1);
  });

  it("变异输入：纯装饰的品牌底纹（没有文字）放行", () => {
    const ok = makeSource(
      "components/x.tsx",
      `export function X() { return (<div className="bg-primary/20" />); }`
    );
    expect(findBrandTextOnBrand([ok])).toEqual([]);
  });

  it("变异输入：bg-primary/[0.08] 这种写法也认得出档位", () => {
    const bad = makeSource(
      "components/x.tsx",
      `export function X() { return (<span className="bg-primary/[0.08] text-primary">已配置</span>); }`
    );
    expect(findBrandTextOnBrand([bad]).length).toBe(1);
  });
});
