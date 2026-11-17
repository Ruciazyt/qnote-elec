import ts from "typescript";


export const HOMEPAGE_REL = "pages/home/HomePage.tsx";

export interface BrandStyleIssue {
  rule: string;
  detail: string;
  line: number;
}

const TAILWIND_TINT_STEPS = new Set([
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
]);

const BRAND_BG = /^bg-primary\/(\d+)$/;
const BRAND_BORDER = /^border-primary\/(\d+)$/;
const BRAND_TEXT_TINT = /^text-primary\/(\d+)$/;

const PLAIN_BRAND_TEXT = /(?:^|:)text-primary$/;
const STRONG_BRAND_TEXT = /(?:^|:)text-primary-strong$/;


function evalExpression(
  node: ts.Expression | undefined,
  consts: Map<string, string>
): string {
  if (!node) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      out += evalExpression(span.expression, consts) + span.literal.text;
    }
    return out;
  }
  if (ts.isJsxExpression(node)) {
    return evalExpression(node.expression, consts);
  }
  if (ts.isIdentifier(node)) {
    return consts.get(node.text) ?? "";
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return evalExpression(node.left, consts) + evalExpression(node.right, consts);
  }
  if (ts.isParenthesizedExpression(node)) {
    return evalExpression(node.expression, consts);
  }
  return "";
}

function collectConstants(sf: ts.SourceFile): Map<string, string> {
  const consts = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const value = evalExpression(node.initializer, consts);
      if (value) consts.set(node.name.text, value);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return consts;
}

function attrName(attr: ts.JsxAttribute): string {
  return ts.isIdentifier(attr.name) ? attr.name.text : "";
}

function jsxParts(
  node: ts.Node
): { tag: string; attributes: ts.JsxAttributes } | null {
  if (ts.isJsxElement(node)) {
    return {
      tag: ts.isIdentifier(node.openingElement.tagName)
        ? node.openingElement.tagName.text
        : "",
      attributes: node.openingElement.attributes,
    };
  }
  if (ts.isJsxSelfClosingElement(node)) {
    return {
      tag: ts.isIdentifier(node.tagName) ? node.tagName.text : "",
      attributes: node.attributes,
    };
  }
  return null;
}

function classTokensOf(
  node: ts.Node,
  consts: Map<string, string>
): string[] {
  const parts = jsxParts(node);
  if (!parts) return [];
  const attr = parts.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && attrName(p) === "className"
  );
  if (!attr || !attr.initializer) return [];
  return evalExpression(attr.initializer, consts)
    .split(/\s+/)
    .filter(Boolean);
}


function checkElement(
  node: ts.Node,
  sf: ts.SourceFile,
  consts: Map<string, string>,
  out: BrandStyleIssue[]
): void {
  const tokens = classTokensOf(node, consts);
  if (!tokens.length) return;

  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const push = (rule: string, detail: string) => out.push({ rule, detail, line });

  const isIcon = tokens.includes("h-8") && tokens.includes("w-8");
  if (isIcon) {
    if (!tokens.includes("text-primary")) {
      push("icon-color", "空状态图标要用 text-primary（图形线 3:1）");
    }
    if (tokens.includes("text-primary-strong")) {
      push("icon-color", "图标是图形，用 text-primary，不用 text-primary-strong");
    }
    const tinted = tokens.find((t) => BRAND_TEXT_TINT.test(t));
    if (tinted) {
      push("icon-tint", `图标文字色不能带透明度档（${tinted}）`);
    }
  }

  for (const t of tokens) {
    const m = BRAND_BG.exec(t) ?? BRAND_BORDER.exec(t);
    if (m && !TAILWIND_TINT_STEPS.has(Number(m[1]))) {
      push("non-standard-tint", `${t} 不是 Tailwind 会生成的档位，写了也不生效`);
    }
  }

  const hasBrandBg = tokens.some((t) => BRAND_BG.test(t));
  const hasBrandText = tokens.some(
    (t) => PLAIN_BRAND_TEXT.test(t) || STRONG_BRAND_TEXT.test(t)
  );
  if (hasBrandBg && hasBrandText) {
    if (!tokens.includes("text-primary-strong")) {
      push("button-color", "品牌底纹上的文字要用 text-primary-strong");
    }
    if (!tokens.includes("hover:text-primary-strong")) {
      push(
        "button-hover-color",
        "按钮要显式写 hover:text-primary-strong，压住 outline 变体自带的 hover:text-accent-foreground"
      );
    }
    if (tokens.includes("dark:text-primary-strong")) {
      push(
        "button-dark-variant",
        "暗色由 --primary-strong 变量自动切，不要写 dark:text-primary-strong"
      );
    }
    if (tokens.includes("text-primary")) {
      push("brand-text-on-brand-bg", "品牌底纹上不能用实心 text-primary");
    }
  }
}

export function findHomepageBrandIssues(
  sources: { rel: string; sf: ts.SourceFile }[]
): BrandStyleIssue[] {
  const targets = sources.filter((s) => s.rel === HOMEPAGE_REL);
  if (!targets.length) {
    return [
      {
        rule: "file-missing",
        detail: `找不到 ${HOMEPAGE_REL}，口径检查会静默失效`,
        line: 0,
      },
    ];
  }

  const out: BrandStyleIssue[] = [];
  for (const { sf } of targets) {
    const consts = collectConstants(sf);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        checkElement(node, sf, consts, out);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

export interface HomePageElement {
  line: number;
  tag: string;
  tokens: string[];
}

export function findHomepageElements(
  sources: { rel: string; sf: ts.SourceFile }[]
): HomePageElement[] {
  const out: HomePageElement[] = [];
  for (const { rel, sf } of sources) {
    if (rel !== HOMEPAGE_REL) continue;
    const consts = collectConstants(sf);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tokens = classTokensOf(node, consts);
        if (tokens.length) {
          const parts = jsxParts(node);
          out.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            tag: parts ? parts.tag : "",
            tokens,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}


function extractBlock(css: string, selector: string): string | null {
  const m = new RegExp(`${selector}\\s*\\{`).exec(css);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return css.slice(start, i - 1);
}

export function readPrimaryStrong(
  css: string,
  scope: "root" | "dark"
): string | null {
  const block = extractBlock(css, scope === "dark" ? "\\.dark" : ":root");
  if (!block) return null;
  const m = /--primary-strong:([^;]+);/.exec(block);
  return m ? m[1].trim() : null;
}
