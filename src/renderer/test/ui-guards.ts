import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { collectSourceFiles } from "./electron-contract";

/**
 * UI 守卫：把几类「代码看着对、实际不合规」的问题变成会红的断言
 *
 * 这四条都是设计规范里写死的硬要求，靠人记着迟早漏：
 *   1. 焦点环厚度 —— 基线是 2px（button 基类 ring-2），ring-1 不算数
 *   2. 隐藏控件   —— 视觉藏起来的可聚焦元素必须同时能被键盘看见
 *   3. 破坏性确认框 —— 正文进 DialogDescription，且要点名是哪一个
 *   4. 品牌色文字 —— bg-primary/N 底上不能用 text-primary 当字色
 *
 * 检测走 TS AST，不用正则 —— className 经常是 cn() 拼出来的，
 * 一行里还可能有条件表达式，正则只能看到一半。
 */

/** 一处违规 */
export interface Violation {
  /** 相对 src/renderer 的文件路径 */
  file: string;
  /** 违规类型 */
  kind: string;
  /** 一句话说明 */
  detail: string;
  /** 基线比对用的稳定签名（不含行号 —— 行号会随改动漂移） */
  signature: string;
  /** 行号 —— 只给人看，基线比对不用它 */
  line: number;
}

/** UI 基类目录（相对 src/renderer） */
export const UI_DIR = "components/ui";

/** 破坏性确认框 —— 正文必须进 DialogDescription，且要点名目标 */
export interface DestructiveDialogSpec {
  /** 相对 src/renderer 的文件路径 */
  file: string;
  /** 目标名的标识符；没有目标（清空全部这类）写 null */
  targetProp: string | null;
  /** 一句话说明 */
  label: string;
}

/* ============================================================
 * 通用：读文件、建语法树、收集 className
 * ============================================================ */

export function readRendererSources(root: string): { file: string; rel: string; sf: ts.SourceFile }[] {
  const out: { file: string; rel: string; sf: ts.SourceFile }[] = [];

  for (const file of collectSourceFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    out.push({ file, rel, sf });
  }

  return out;
}

/** 造一个源码条目 —— 变异输入用 */
export function makeSource(rel: string, text: string): { rel: string; sf: ts.SourceFile } {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return { rel, sf };
}

/** 收集一个表达式里出现的所有字符串字面量 */
function collectStringLiterals(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** 把 class 字符串拆成 token */
export function classTokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * JSX 属性名
 *
 * 属性名也可能是命名空间形式（xlink:href），那种没有 .text。
 */
export function attrName(attr: ts.JsxAttribute): string {
  return ts.isIdentifier(attr.name) ? attr.name.text : "";
}

/** 取 JSX 元素上 className 里的全部 token */
export function elementClassTokens(element: ts.JsxElement): string[] {
  const attr = element.openingElement.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && attrName(p) === "className"
  );
  if (!attr || !attr.initializer) return [];

  const literals = ts.isStringLiteral(attr.initializer)
    ? [attr.initializer.text]
    : collectStringLiterals(attr.initializer);

  return literals.flatMap(classTokens);
}

/** 建父子映射 —— 判「祖先藏了可聚焦元素」要用 */
function buildParents(sf: ts.SourceFile): Map<ts.Node, ts.Node> {
  const parents = new Map<ts.Node, ts.Node>();
  const visit = (node: ts.Node) => {
    ts.forEachChild(node, (child) => {
      parents.set(child, node);
      visit(child);
    });
  };
  visit(sf);
  return parents;
}

/* ============================================================
 * 守卫一：焦点环厚度
 * ============================================================ */

/** 焦点环的基线是 2px（button 基类 ring-2）——ring-1 不算数 */
const THIN_FOCUS_RING_TOKENS = ["focus:ring-1", "focus-visible:ring-1"];

/**
 * ui 基类里出现 focus:ring-1 就红
 *
 * 只看 components/ui —— 业务组件里的 ring-1 是描边装饰，不是焦点指示器。
 */
export function findThinFocusRings(sources: { rel: string; sf: ts.SourceFile }[]): Violation[] {
  const out: Violation[] = [];

  for (const { rel, sf } of sources) {
    if (!rel.startsWith(`${UI_DIR}/`)) continue;

    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const tokens = classTokens(node.text);
        for (const thin of THIN_FOCUS_RING_TOKENS) {
          if (!tokens.includes(thin)) continue;
          out.push({
            file: rel,
            kind: "thin-focus-ring",
            detail: `${thin} 是 1px 焦点环，基线是 2px`,
            signature: `${rel}|${thin}`,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return out;
}

/* ============================================================
 * 守卫二：隐藏控件
 * ============================================================ */

/**
 * 视觉藏起来的标记
 *
 * 除了 opacity-0，还有「字色全透明」这一类 —— text-foreground/0、
 * text-muted-foreground/0 都是完全看不见，性质和 opacity-0 一样。
 * 只认 opacity-0 会漏掉书签那两颗按钮（它们用的是 text-muted-foreground/0）。
 */
const VISUAL_HIDDEN_EXACT = new Set(["opacity-0", "text-transparent"]);
/** 任意颜色的 0 透明度：text-foreground/0、text-muted-foreground/0 … */
const VISUAL_HIDDEN_PATTERN = /^text-[a-z0-9-]+\/0$/;

function isVisualHidden(tokens: string[]): boolean {
  return tokens.some(
    (t) => VISUAL_HIDDEN_EXACT.has(t) || VISUAL_HIDDEN_PATTERN.test(t)
  );
}

/** 鼠标点不到 */
const MOUSE_BLOCKED_TOKENS = ["pointer-events-none"];
/**
 * 鼠标点得到 —— pointer-events 可被子元素覆盖
 *
 * 祖先 pointer-events-none 时，子元素自己写 pointer-events-auto 就还是能点。
 */
const MOUSE_REACHABLE_TOKENS = ["pointer-events-auto", "group-hover:pointer-events-auto"];
/** 结构性隐藏 —— 这两种根本不留在焦点序里，不算违规 */
const STRUCTURAL_HIDDEN_TOKENS = ["invisible", "hidden"];
/** 键盘聚焦时显形 —— 有这个就放行 */
const FOCUS_REVEAL_TOKENS = [
  "focus:opacity-100",
  "focus-visible:opacity-100",
  "focus-within:opacity-100",
  "focus:pointer-events-auto",
  "focus-visible:pointer-events-auto",
  "focus-within:pointer-events-auto",
];

/**
 * 悬停时显形 —— 只解决鼠标，键盘还是看不见
 *
 * 「悬停才出现」本身是常见设计（操作区、关闭按钮），不算违规；
 * 但它不能替代 focus 显形规则。
 */
const HOVER_REVEAL_PATTERN = /^(group-hover|hover)(\/[\w-]+)?:opacity-\d+$/;

function hasFocusReveal(tokens: string[]): boolean {
  return tokens.some((t) => FOCUS_REVEAL_TOKENS.includes(t));
}

function hasHoverReveal(tokens: string[]): boolean {
  return tokens.some((t) => HOVER_REVEAL_PATTERN.test(t));
}

const FOCUSABLE_TAGS = new Set(["button", "input", "select", "textarea", "summary"]);

/** 判断一个 JSX 元素是否可聚焦 */
export function isFocusable(element: ts.JsxElement): boolean {
  const tag = element.openingElement.tagName;
  const tagName = ts.isIdentifier(tag) ? tag.text : "";

  const attrs = element.openingElement.attributes.properties.filter(ts.isJsxAttribute);
  const has = (name: string) => attrs.some((a) => attrName(a) === name);
  const disabled = attrs.some((a) => attrName(a) === "disabled");

  if (has("tabIndex")) return true;
  if (tagName === "a") return has("href");
  if (FOCUSABLE_TAGS.has(tagName)) return !disabled;
  return false;
}

/**
 * 自定义组件索引 —— Button 这种组件名不是原生标签，但它渲染的是 button
 *
 * 不解析的话，「按钮被藏起来」这种问题只会漏在自定义组件上
 * （shadcn 的 Button、IconButton 之类）。
 */
export interface ComponentIndex {
  /** 组件名 → 声明 */
  byName: Map<string, { sf: ts.SourceFile; decl: ts.Node }>;
  /** 文件 → 局部标签常量（const Comp = "button"） */
  tagBindings: Map<ts.SourceFile, Map<string, string[]>>;
}

/** 收集导出的组件声明 */
export function buildComponentIndex(sources: { rel: string; sf: ts.SourceFile }[]): ComponentIndex {
  const byName = new Map<string, { sf: ts.SourceFile; decl: ts.Node }>();
  const tagBindings = new Map<ts.SourceFile, Map<string, string[]>>();

  for (const { sf } of sources) {
    // 局部标签常量：const Comp = asChild ? Slot : "button"
    const bindings = new Map<string, string[]>();
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const literals = collectStringLiterals(decl.initializer);
        if (literals.length) bindings.set(decl.name.text, literals);
      }
    }
    tagBindings.set(sf, bindings);

    // 导出声明：export function X / export const X / export { X }
    for (const stmt of sf.statements) {
      if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const spec of stmt.exportClause.elements) {
          const local = spec.propertyName ?? spec.name;
          const decl = findLocalDeclaration(sf, local.text);
          if (decl) byName.set(spec.name.text, { sf, decl });
        }
        continue;
      }

      const name = exportedName(stmt);
      if (!name) continue;
      if (ts.isFunctionDeclaration(stmt)) {
        byName.set(name, { sf, decl: stmt });
      } else if (ts.isVariableStatement(stmt)) {
        const decl = stmt.declarationList.declarations[0];
        if (decl?.initializer) byName.set(name, { sf, decl: decl.initializer });
      }
    }
  }

  return { byName, tagBindings };
}

/** 在文件里找同名声明 */
function findLocalDeclaration(sf: ts.SourceFile, name: string): ts.Node | null {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return stmt;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return decl.initializer ?? decl;
        }
      }
    }
  }
  return null;
}

/** 取导出声明的名字 */
function exportedName(stmt: ts.Statement): string | null {
  const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
  const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!isExported) return null;

  if (ts.isFunctionDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isVariableStatement(stmt)) {
    const decl = stmt.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}

/**
 * 这个自定义组件的渲染结果里有没有可聚焦元素
 *
 * 深度限制 3 层、组件名去重 —— 组件互相引用时不至于绕死。
 */
export function rendersFocusable(
  element: ts.JsxElement,
  index: ComponentIndex,
  depth = 3,
  seen = new Set<string>()
): boolean {
  const tag = element.openingElement.tagName;
  if (!ts.isIdentifier(tag)) return false;

  const name = tag.text;
  if (seen.has(name)) return false;

  // 局部标签常量：<Comp /> 其中 const Comp = "button"
  const entry = index.byName.get(name);
  const bindings = entry ? index.tagBindings.get(entry.sf) : undefined;
  if (bindings) {
    const values = bindings.get(name);
    if (values?.some((v) => FOCUSABLE_TAGS.has(v))) return true;
  }

  if (!entry) return false;

  const nextSeen = new Set(seen);
  nextSeen.add(name);

  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(node)) {
      const nodeTag = node.openingElement.tagName;
      if (ts.isIdentifier(nodeTag)) {
        const nodeName = nodeTag.text;
        if (FOCUSABLE_TAGS.has(nodeName) && isFocusable(node)) {
          found = true;
          return;
        }
        if (/^[A-Z]/.test(nodeName) && depth > 0 && rendersFocusable(node, index, depth - 1, nextSeen)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(entry.decl);

  return found;
}

/** JSX 元素是否可聚焦 —— 原生标签或渲染出可聚焦元素的自定义组件 */
export function isFocusableElement(
  element: ts.JsxElement,
  index: ComponentIndex
): boolean {
  const tag = element.openingElement.tagName;
  const tagName = ts.isIdentifier(tag) ? tag.text : "";

  if (isFocusable(element)) return true;
  if (/^[A-Z]/.test(tagName)) return rendersFocusable(element, index);
  return false;
}

/**
 * 可聚焦元素被藏起来 —— 键盘能 Tab 到，但看不见（或点不到）
 *
 * 三种情形都算：
 *   - 自己或祖先把它藏了（opacity-0 / 零透明度的字色 / pointer-events-none），没有 focus 显形规则
 *   - 自己里面包着藏起来的内容（按钮里的图标 opacity-0），聚焦时按钮是空的
 *
 * 计的是「藏东西的位置」，不是「被藏住的按钮个数」——
 * 一个包装器把两个按钮一起藏住，算一处；这个口径才和改代码的落点对得上。
 */
export function findHiddenFocusables(sources: { rel: string; sf: ts.SourceFile }[]): Violation[] {
  const out: Violation[] = [];
  const index = buildComponentIndex(sources);

  const DETAIL: Record<string, string> = {
    视觉藏起: "可聚焦元素被藏起来，但没有 focus 显形规则 —— 键盘能 Tab 到却看不见",
    鼠标点不到: "可聚焦元素被 pointer-events-none 挡住，鼠标点不到",
    内容被藏起: "可聚焦元素里的内容被藏起来，聚焦时按钮是空的",
  };

  for (const { rel, sf } of sources) {
    const parents = buildParents(sf);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    /** 从元素自己往上的 JSX 链 */
    const chainOf = (node: ts.Node): ts.JsxElement[] => {
      const chain: ts.JsxElement[] = [];
      let current: ts.Node | undefined = node;
      while (current) {
        if (ts.isJsxElement(current)) chain.push(current);
        current = parents.get(current);
      }
      return chain;
    };

    /** 同一处位置只报一次 —— 两个按钮被同一个包装器藏住，算一处 */
    const seen = new Set<string>();
    const pushOnce = (which: string, at: ts.JsxElement) => {
      const key = `${which}|${at.getStart(sf)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        file: rel,
        kind: "hidden-focusable",
        detail: DETAIL[which],
        signature: `${rel}|${which}`,
        line: lineOf(at),
      });
    };

    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && isFocusableElement(node, index)) {
        const chain = chainOf(node);

        // 结构性隐藏（hidden / invisible）：压根不在焦点序里，视觉和鼠标都不算违规
        const structural = chain.some((el) =>
          elementClassTokens(el).some((t) => STRUCTURAL_HIDDEN_TOKENS.includes(t))
        );

        if (!structural) {
          // 一、藏起来了
          for (const el of chain) {
            const tokens = elementClassTokens(el);
            if (!isVisualHidden(tokens)) continue;
            if (hasFocusReveal(tokens)) continue;
            pushOnce("视觉藏起", el);
          }

          // 二、鼠标点不到 —— 最近一个显式设 pointer-events 的说了算
          for (const el of chain) {
            const tokens = elementClassTokens(el);
            // 先看「点得到」：pointer-events 可被子元素覆盖，
            // 祖先 pointer-events-none + 悬停时 pointer-events-auto，鼠标其实够得着
            if (tokens.some((t) => MOUSE_REACHABLE_TOKENS.includes(t))) break;
            if (!tokens.some((t) => MOUSE_BLOCKED_TOKENS.includes(t))) continue;
            pushOnce("鼠标点不到", el);
            break;
          }
        }

        // 三、里面包着看不见的内容
        const hiddenDescendants: ts.JsxElement[] = [];
        const visitChildren = (n: ts.Node) => {
          if (ts.isJsxElement(n)) {
            const tokens = elementClassTokens(n);
            if (isVisualHidden(tokens) && !hasFocusReveal(tokens) && !hasHoverReveal(tokens)) {
              hiddenDescendants.push(n);
            }
          }
          ts.forEachChild(n, visitChildren);
        };
        ts.forEachChild(node, visitChildren);

        for (const d of hiddenDescendants) {
          // d 到 node 之间的中间层
          const mid: ts.JsxElement[] = [];
          let cur: ts.Node | undefined = parents.get(d);
          while (cur && cur !== node) {
            if (ts.isJsxElement(cur)) mid.push(cur);
            cur = parents.get(cur);
          }
          // 外层已经藏住的 —— 由外层那处代表，不重复报
          if (mid.some((el) => isVisualHidden(elementClassTokens(el)))) continue;
          // 自己或中间层可聚焦 —— 那一处由规则一负责
          if (isFocusableElement(d, index)) continue;
          if (mid.some((el) => isFocusableElement(el, index))) continue;
          pushOnce("内容被藏起", d);
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return out;
}

/* ============================================================
 * 守卫三：破坏性确认框
 * ============================================================ */

/**
 * 破坏性确认框的正文必须由 DialogDescription 承载，并且要点名是哪一个
 *
 * ui/dialog 不会自动生成描述节点 —— 只有真的渲染了 DialogDescription，
 * Radix 才把它的 id 接进 aria-describedby，读屏打开那一下才念得出来。
 */
export function findDestructiveDialogIssues(
  sources: { rel: string; sf: ts.SourceFile }[],
  dialogs: DestructiveDialogSpec[]
): Violation[] {
  const out: Violation[] = [];

  for (const spec of dialogs) {
    const source = sources.find((s) => s.rel === spec.file);
    if (!source) {
      out.push({
        file: spec.file,
        kind: "destructive-dialog",
        detail: "文件不存在，破坏性确认框清单可能过期了",
        signature: `${spec.file}|文件缺失`,
        line: 0,
      });
      continue;
    }

    const descriptions: ts.JsxElement[] = [];
    let hasContent = false;
    let contentAt: ts.JsxElement | null = null;

    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName;
        const tagName = ts.isIdentifier(tag) ? tag.text : "";
        if (tagName === "DialogContent") {
          hasContent = true;
          contentAt = node;
        }
        if (tagName === "DialogDescription") descriptions.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source.sf);

    const lineOf = (n: ts.Node) =>
      source.sf.getLineAndCharacterOfPosition(n.getStart(source.sf)).line + 1;

    if (!hasContent || !contentAt) {
      out.push({
        file: spec.file,
        kind: "destructive-dialog",
        detail: "找不到 DialogContent —— 清单可能过期了",
        signature: `${spec.file}|没有 DialogContent`,
        line: 0,
      });
      continue;
    }

    if (descriptions.length === 0) {
      out.push({
        file: spec.file,
        kind: "destructive-dialog",
        detail: "正文没进 DialogDescription —— aria-describedby 指不到任何节点",
        signature: `${spec.file}|缺 DialogDescription`,
        line: lineOf(contentAt),
      });
      continue;
    }

    if (spec.targetProp) {
      const identifiers = new Set<string>();
      for (const desc of descriptions) {
        const collect = (n: ts.Node) => {
          if (ts.isIdentifier(n)) identifiers.add(n.text);
          ts.forEachChild(n, collect);
        };
        collect(desc);
      }
      if (!identifiers.has(spec.targetProp)) {
        out.push({
          file: spec.file,
          kind: "destructive-dialog",
          detail: `描述里没有点名目标（${spec.targetProp}）—— 读屏只念得出「删的是某一类」，念不出是哪一个`,
          signature: `${spec.file}|描述没点名`,
          line: lineOf(descriptions[0]),
        });
      }
    }
  }

  return out;
}

/* ============================================================
 * 守卫四：品牌色当文字
 * ============================================================ */

const BRAND_BG = /^bg-primary(\/\S+)?$/;
const BRAND_TEXT = /^text-primary(\/\S+)?$/;
/** 品牌色文字的深档 */
const BRAND_STRONG_TEXT = /^text-primary-strong(\/\S+)?$/;

/**
 * 品牌底纹的最深档（按「文字色 × 底纹档」两维判）
 *
 *   文字用实心 --primary       → 任何品牌底纹都不过线（/5 就已经 4.42）
 *   文字用 --primary-strong    → 底纹上限 /15，/20 是 4.41，禁用
 */
export const MAX_BRAND_TINT = 15;

/**
 * 拆出变体前缀与工具类
 *
 * "hover:bg-primary/10" → { state: "hover", util: "bg-primary/10" }
 * "group-hover/att:opacity-100" → { state: "group-hover/att", util: "opacity-100" }
 * "bg-[color:rgb(1,2,3)]" → 不是变体（前缀里带方括号，不合法）
 */
const VARIANT_RE =
  /^((?:[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?)(?::[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?)*):(.+)$/;

function splitVariant(token: string): { state: string; util: string } {
  const m = VARIANT_RE.exec(token);
  if (!m) return { state: "", util: token };
  return { state: m[1], util: m[2] };
}

/**
 * 品牌底纹的档位数字
 *
 * "bg-primary/20" → 20；"bg-primary/[0.08]" → 8；"bg-primary" → 100（实心）
 * "bg-primary/0" → 0（全透明，不算底纹）
 */
export function brandTint(token: string): number {
  const util = splitVariant(token).util;
  const m = /^bg-primary\/(\d+)$/.exec(util);
  if (m) return Number(m[1]);
  const b = /^bg-primary\/\[([\d.]+)\]$/.exec(util);
  if (b) return Math.round(Number(b[1]) * 100);
  if (util === "bg-primary") return 100;
  return 0;
}

/**
 * bg-primary/N 底上用 text-primary 当字色 —— 同一个品牌色压自己，对比度不够
 *
 * text-primary-strong 是专门开的深档文字色，放行。
 */
export function findBrandTextOnBrand(sources: { rel: string; sf: ts.SourceFile }[]): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();

  const push = (
    rel: string,
    sf: ts.SourceFile,
    kind: string,
    signature: string,
    detail: string,
    at: ts.Node
  ) => {
    const key = `${kind}|${signature}|${at.getStart(sf)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      file: rel,
      kind,
      detail,
      signature,
      line: sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1,
    });
  };

  /** 这一组里最深的品牌底纹（0 表示没有底纹） */
  const deepestBrandBg = (tokens: string[]): string | null => {
    const usable = tokens.filter((t) => BRAND_BG.test(splitVariant(t).util) && brandTint(t) > 0);
    if (!usable.length) return null;
    return usable.sort((a, b) => brandTint(b) - brandTint(a))[0];
  };

  const check = (
    rel: string,
    sf: ts.SourceFile,
    tokens: string[],
    where: string,
    at: ts.Node
  ) => {
    /* 一、基础态：同一个元素上品牌底纹与品牌文字同现
     *
     * 实心 --primary 作文字：任何品牌底纹都不过线（/5 就已经 4.42）
     * --primary-strong 作文字：底纹上限 /15，/20 是 4.41，禁用
     */
    const baseBg = tokens.filter((t) => BRAND_BG.test(t));
    const baseText = tokens.filter((t) => BRAND_TEXT.test(t));
    const baseStrong = tokens.filter((t) => BRAND_STRONG_TEXT.test(t));
    const baseDeepest = deepestBrandBg(baseBg);

    if (baseBg.length && baseText.length) {
      const overLimit = baseDeepest ? brandTint(baseDeepest) > MAX_BRAND_TINT : false;
      push(
        rel,
        sf,
        overLimit ? "brand-tint-too-deep" : "brand-text-on-brand",
        `${rel}|${tokens
          .filter((t) => BRAND_BG.test(t) || BRAND_TEXT.test(t))
          .sort()
          .join(" ")}`,
        overLimit
          ? `品牌底纹到 /${brandTint(baseDeepest!)}（超过 /${MAX_BRAND_TINT} 禁用档），文字还是品牌色`
          : `${where} 品牌色底上用 text-primary 当字色，应改 text-primary-strong`,
        at
      );
    }

    if (baseStrong.length && baseDeepest && brandTint(baseDeepest) > MAX_BRAND_TINT) {
      push(
        rel,
        sf,
        "brand-tint-too-deep",
        `${rel}|${splitVariant(baseDeepest).util} ${splitVariant(baseStrong[0]).util}`,
        `${where} 品牌底纹到 /${brandTint(baseDeepest)}（超过 /${MAX_BRAND_TINT} 禁用档），文字压不住`,
        at
      );
    }

    /* 二、变体态：hover / focus / active 时才出现的品牌底纹 + 品牌文字
     *
     * 「同一个元素、同一段 class」这种口径看不见悬停态 ——
     * 而悬停态恰恰是最常见的写法（hover:bg-primary/10 hover:text-primary）。
     * 这里按状态分组，基础态的类名在变体态里依然生效，所以要把基础态一起算进来。
     */
    const states = new Map<string, string[]>();
    for (const token of tokens) {
      const { state } = splitVariant(token);
      if (!state) continue;
      const arr = states.get(state) ?? [];
      arr.push(token);
      states.set(state, arr);
    }

    for (const [state, stateTokens] of states) {
      // 变体态自己带来的品牌底纹
      const ownBg = stateTokens.filter((t) => BRAND_BG.test(splitVariant(t).util));
      if (!ownBg.length) continue;

      // 生效的类名 = 基础态 + 这一档变体态
      const effective = [...tokens.filter((t) => !splitVariant(t).state), ...stateTokens];
      const brandText = effective.filter((t) => BRAND_TEXT.test(splitVariant(t).util));
      const strongText = effective.filter((t) => BRAND_STRONG_TEXT.test(splitVariant(t).util));
      const deepest = deepestBrandBg(effective);
      if (!deepest) continue;

      const tint = brandTint(deepest);

      if (brandText.length) {
        push(
          rel,
          sf,
          tint > MAX_BRAND_TINT ? "brand-tint-too-deep" : "brand-text-on-brand-state",
          `${rel}|${state}:${splitVariant(deepest).util} ${splitVariant(brandText[0]).util}`,
          tint > MAX_BRAND_TINT
            ? `${state} 态品牌底纹到 /${tint}（超过 /${MAX_BRAND_TINT} 禁用档），文字还是品牌色`
            : `${where} ${state} 态品牌色底上用 text-primary 当字色，应改 text-primary-strong`,
          at
        );
      } else if (strongText.length && tint > MAX_BRAND_TINT) {
        push(
          rel,
          sf,
          "brand-tint-too-deep",
          `${rel}|${state}:${splitVariant(deepest).util} ${splitVariant(strongText[0]).util}`,
          `${state} 态品牌底纹到 /${tint}（超过 /${MAX_BRAND_TINT} 禁用档），文字压不住`,
          at
        );
      }
    }
  };

  for (const { rel, sf } of sources) {
    const parents = buildParents(sf);

    /** 这个字面量是不是已经算在「同一个元素上」里了 */
    const insideClassNameAttr = (node: ts.Node): boolean => {
      let current: ts.Node | undefined = node;
      while (current) {
        if (
          ts.isJsxAttribute(current) &&
          attrName(current) === "className"
        ) {
          return true;
        }
        current = parents.get(current);
      }
      return false;
    };

    // 一、JSX 元素：className 里两个 token 同现
    const visitElement = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        check(rel, sf, elementClassTokens(node), "同一个元素上", node);
      }
      ts.forEachChild(node, visitElement);
    };
    visitElement(sf);

    // 二、字符串字面量：settings-card 那类常量表（badge: "bg-primary/10 text-primary"）
    // 已经算在元素上的不重复数
    const visitLiteral = (node: ts.Node) => {
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        !insideClassNameAttr(node)
      ) {
        check(rel, sf, classTokens(node.text), "同一段 class 里", node);
      }
      ts.forEachChild(node, visitLiteral);
    };
    visitLiteral(sf);
  }

  return out;
}

/* ============================================================
 * 基线比对
 * ============================================================ */

/**
 * 把当前违规与基线比对
 *
 * 返回新出现的违规（基线里没有的）—— 这才是要拦下的。
 * 基线里有、现在没了的（被修好了的）单独返回，用来提醒更新基线。
 */
export function diffViolations(
  current: Violation[],
  baseline: Record<string, number>
): { added: Violation[]; fixed: string[] } {
  const countOf = (list: Violation[]) => {
    const map = new Map<string, number>();
    for (const v of list) map.set(v.signature, (map.get(v.signature) ?? 0) + 1);
    return map;
  };

  const currentCount = countOf(current);
  const added: Violation[] = [];

  for (const [signature, count] of currentCount) {
    const known = baseline[signature] ?? 0;
    if (count > known) {
      const extra = count - known;
      const sample = current.find((v) => v.signature === signature)!;
      for (let i = 0; i < extra; i++) added.push({ ...sample, detail: `${sample.detail}（新增 ${extra} 处）` });
    }
  }

  const fixed: string[] = [];
  for (const [signature, count] of Object.entries(baseline)) {
    const now = currentCount.get(signature) ?? 0;
    if (now < count) fixed.push(signature);
  }

  return { added, fixed };
}
