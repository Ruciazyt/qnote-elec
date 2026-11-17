import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { collectSourceFiles } from "./electron-contract";


export interface Violation {
  file: string;
  kind: string;
  detail: string;
  signature: string;
  line: number;
}

export const UI_DIR = "components/ui";

export interface DestructiveDialogSpec {
  file: string;
  targetProp: string | null;
  label: string;
}


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

export function makeSource(rel: string, text: string): { rel: string; sf: ts.SourceFile } {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return { rel, sf };
}

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

export function classTokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function attrName(attr: ts.JsxAttribute): string {
  return ts.isIdentifier(attr.name) ? attr.name.text : "";
}

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


const THIN_FOCUS_RING_TOKENS = ["focus:ring-1", "focus-visible:ring-1"];

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


const VISUAL_HIDDEN_EXACT = new Set(["opacity-0", "text-transparent"]);
const VISUAL_HIDDEN_PATTERN = /^text-[a-z0-9-]+\/0$/;

function isVisualHidden(tokens: string[]): boolean {
  return tokens.some(
    (t) => VISUAL_HIDDEN_EXACT.has(t) || VISUAL_HIDDEN_PATTERN.test(t)
  );
}

function isOpacityHidden(tokens: string[]): boolean {
  return tokens.includes("opacity-0");
}

function isTransparentTextHidden(tokens: string[]): boolean {
  return (
    tokens.includes("text-transparent") ||
    tokens.some((t) => VISUAL_HIDDEN_PATTERN.test(t))
  );
}

const MOUSE_BLOCKED_TOKENS = ["pointer-events-none"];
const MOUSE_REACHABLE_TOKENS = ["pointer-events-auto", "group-hover:pointer-events-auto"];
const STRUCTURAL_HIDDEN_TOKENS = ["invisible", "hidden"];
const FOCUS_REVEAL_TOKENS = [
  "focus:opacity-100",
  "focus-visible:opacity-100",
  "focus-within:opacity-100",
  "focus:pointer-events-auto",
  "focus-visible:pointer-events-auto",
  "focus-within:pointer-events-auto",
];

const HOVER_REVEAL_PATTERN = /^(group-hover|hover)(\/[\w-]+)?:opacity-\d+$/;

const FOCUS_SOLID_TEXT_PATTERN = /^focus(-visible|-within)?:!?text-[a-z0-9-]+$/;
const FOCUS_TRANSPARENT_TEXT_PATTERN = /^focus(-visible|-within)?:!?text-transparent$/;

function hasFocusReveal(tokens: string[]): boolean {
  return tokens.some((t) => FOCUS_REVEAL_TOKENS.includes(t));
}

function hasFocusSolidText(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      FOCUS_SOLID_TEXT_PATTERN.test(t) &&
      !FOCUS_TRANSPARENT_TEXT_PATTERN.test(t)
  );
}

function hasHoverReveal(tokens: string[]): boolean {
  return tokens.some((t) => HOVER_REVEAL_PATTERN.test(t));
}

function hasRevealForHidden(tokens: string[]): boolean {
  if (hasFocusReveal(tokens)) return true;
  if (isOpacityHidden(tokens)) return false;
  if (!isTransparentTextHidden(tokens)) return false;
  return hasFocusSolidText(tokens);
}

const FOCUSABLE_TAGS = new Set(["button", "input", "select", "textarea", "summary"]);

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

export interface ComponentIndex {
  byName: Map<string, { sf: ts.SourceFile; decl: ts.Node }>;
  tagBindings: Map<ts.SourceFile, Map<string, string[]>>;
}

export function buildComponentIndex(sources: { rel: string; sf: ts.SourceFile }[]): ComponentIndex {
  const byName = new Map<string, { sf: ts.SourceFile; decl: ts.Node }>();
  const tagBindings = new Map<ts.SourceFile, Map<string, string[]>>();

  for (const { sf } of sources) {
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

    const chainOf = (node: ts.Node): ts.JsxElement[] => {
      const chain: ts.JsxElement[] = [];
      let current: ts.Node | undefined = node;
      while (current) {
        if (ts.isJsxElement(current)) chain.push(current);
        current = parents.get(current);
      }
      return chain;
    };

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

        const structural = chain.some((el) =>
          elementClassTokens(el).some((t) => STRUCTURAL_HIDDEN_TOKENS.includes(t))
        );

        if (!structural) {
          for (const el of chain) {
            const tokens = elementClassTokens(el);
            if (!isVisualHidden(tokens)) continue;
            if (hasRevealForHidden(tokens)) continue;
            pushOnce("视觉藏起", el);
          }

          for (const el of chain) {
            const tokens = elementClassTokens(el);
            if (tokens.some((t) => MOUSE_REACHABLE_TOKENS.includes(t))) break;
            if (!tokens.some((t) => MOUSE_BLOCKED_TOKENS.includes(t))) continue;
            pushOnce("鼠标点不到", el);
            break;
          }
        }

        const hiddenDescendants: ts.JsxElement[] = [];
        const visitChildren = (n: ts.Node) => {
          if (ts.isJsxElement(n)) {
            const tokens = elementClassTokens(n);
            if (
              isVisualHidden(tokens) &&
              !hasRevealForHidden(tokens) &&
              !hasHoverReveal(tokens)
            ) {
              hiddenDescendants.push(n);
            }
          }
          ts.forEachChild(n, visitChildren);
        };
        ts.forEachChild(node, visitChildren);

        for (const d of hiddenDescendants) {
          const mid: ts.JsxElement[] = [];
          let cur: ts.Node | undefined = parents.get(d);
          while (cur && cur !== node) {
            if (ts.isJsxElement(cur)) mid.push(cur);
            cur = parents.get(cur);
          }
          if (mid.some((el) => isVisualHidden(elementClassTokens(el)))) continue;
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


const BRAND_BG = /^bg-primary(\/\S+)?$/;
const BRAND_TEXT = /^text-primary(\/\S+)?$/;
const BRAND_STRONG_TEXT = /^text-primary-strong(\/\S+)?$/;

export const MAX_BRAND_TINT = 15;

const VARIANT_RE =
  /^((?:[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?)(?::[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?)*):(.+)$/;

function splitVariant(token: string): { state: string; util: string } {
  const m = VARIANT_RE.exec(token);
  if (!m) return { state: "", util: token };
  return { state: m[1], util: m[2] };
}

export function brandTint(token: string): number {
  const util = splitVariant(token).util;
  const m = /^bg-primary\/(\d+)$/.exec(util);
  if (m) return Number(m[1]);
  const b = /^bg-primary\/\[([\d.]+)\]$/.exec(util);
  if (b) return Math.round(Number(b[1]) * 100);
  if (util === "bg-primary") return 100;
  return 0;
}

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
          .sort((a, b) => a.localeCompare(b))
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

    const states = new Map<string, string[]>();
    for (const token of tokens) {
      const { state } = splitVariant(token);
      if (!state) continue;
      const arr = states.get(state) ?? [];
      arr.push(token);
      states.set(state, arr);
    }

    for (const [state, stateTokens] of states) {
      const ownBg = stateTokens.filter((t) => BRAND_BG.test(splitVariant(t).util));
      if (!ownBg.length) continue;

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

    const visitElement = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        check(rel, sf, elementClassTokens(node), "同一个元素上", node);
      }
      ts.forEachChild(node, visitElement);
    };
    visitElement(sf);

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
