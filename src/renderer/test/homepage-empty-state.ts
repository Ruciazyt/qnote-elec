import ts from "typescript";

/**
 * 首页空状态的品牌色口径检查
 *
 * 2026-11-05 发出去的 1.9.0 用的是被叫停的那版：图标用了 text-primary-strong、
 * 按钮带了冗余的 dark:text-primary-strong、装饰光晕用了 bg-primary/12
 * （Tailwind 不生成这个档位，写了等于没写）。
 *
 * 这份检测把这几处口径写成会红的断言，改回错版就会红。
 *
 * 三条口径与依据：
 *   1. 图标走图形线（3:1）—— 用 text-primary，不带透明度档
 *   2. 按钮文字走正文线（4.5:1）—— 品牌底纹上用 text-primary-strong，
 *      且要显式写 hover:text-primary-strong 压住 outline 变体自带的
 *      hover:text-accent-foreground；暗色由 --primary-strong 变量自动切，
 *      类名层面不写 dark 变体
 *   3. 品牌底纹的透明度必须是 Tailwind 会生成的档位（5 的倍数）
 *
 * 暗色适配查 CSS 变量（index.css 的 .dark 作用域），不查类名 ——
 * 暗色是变量值说了算，类名里加 dark: 反而会盖掉变量。
 *
 * 取类名时三个会踩空的地方（都踩过，守卫曾整轮空转 —— 查不出违规与没有违规
 * 长得一模一样）：
 *   1. 自闭合元素（<SearchX className="…" />）在 AST 里是 JsxSelfClosingElement，
 *      不是 JsxElement —— 只判 JsxElement 会把图标和装饰光晕整类漏掉
 *   2. JSX 属性里的双引号字符串不插值，"${…}" 拿到的是字面文本，
 *      要用表达式容器（className={`…`}）才会走模板求值
 *   3. 常量必须带引号 —— 裸标识符（const ICON = text-primary-strong）
 *      会被解析成减法表达式，evalExpression 取不到值
 */

/** 被检查的文件（相对 src/renderer） */
export const HOMEPAGE_REL = "pages/HomePage.tsx";

export interface BrandStyleIssue {
  /** 规则代号 */
  rule: string;
  /** 一句话说明 */
  detail: string;
  /** 行号 */
  line: number;
}

/** Tailwind 默认透明度档 —— 只有这些值会生成 CSS */
const TAILWIND_TINT_STEPS = new Set([
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
]);

/** bg-primary/N —— 品牌底纹 */
const BRAND_BG = /^bg-primary\/(\d+)$/;
/** border-primary/N —— 品牌描边 */
const BRAND_BORDER = /^border-primary\/(\d+)$/;
/** text-primary/N —— 品牌文字色带档 */
const BRAND_TEXT_TINT = /^text-primary\/(\d+)$/;

/** 实心的品牌文字色（含 hover: 之类的前缀） */
const PLAIN_BRAND_TEXT = /(?:^|:)text-primary$/;
/** 品牌强文字色（含 hover: 之类的前缀） */
const STRONG_BRAND_TEXT = /(?:^|:)text-primary-strong$/;

/* ============================================================
 * 取 className 上的类名
 * ============================================================ */

/**
 * 求值一个表达式，取出其中的类名文本
 *
 * 除了字面量，还要能读懂「常量 + 模板插值」：
 * 测试里为了不被品牌色守卫误判，坏例子常写成
 * `const BTN = "文字";` + `className="底纹 ${BTN}"` 这种形式，
 * 只认字面量会看不到拼出来的类名。
 */
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

/** 收集文件里 `const 名 = "字符串"` 形式的常量 */
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

/** JSX 属性名 */
function attrName(attr: ts.JsxAttribute): string {
  return ts.isIdentifier(attr.name) ? attr.name.text : "";
}

/**
 * 取一个 JSX 节点的标签名与属性
 *
 * 自闭合元素（<SearchX className="…" />）在 AST 里是 JsxSelfClosingElement，
 * 不是 JsxElement —— 只判 JsxElement 会把首页的图标和装饰光晕整类漏掉，
 * 守卫会变成空转：查不出任何东西，看起来「全绿」其实什么都没查。
 */
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

/** 取一个 JSX 节点 className 上的全部 token */
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

/* ============================================================
 * 口径检查
 * ============================================================ */

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

  /* 一、图标色 —— 空状态图标是图形，走 3:1 线 */
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

  /* 二、品牌底纹的档位 —— 非 5 倍数的值 Tailwind 根本不生成 */
  for (const t of tokens) {
    const m = BRAND_BG.exec(t) ?? BRAND_BORDER.exec(t);
    if (m && !TAILWIND_TINT_STEPS.has(Number(m[1]))) {
      push("non-standard-tint", `${t} 不是 Tailwind 会生成的档位，写了也不生效`);
    }
  }

  /* 三、品牌底纹上的文字色 */
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

/**
 * 检查首页的品牌色口径
 *
 * 找不到被检查的文件时也返回一条 —— 静默通过比报错更难查。
 */
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

/** 首页里一个带 className 的元素 */
export interface HomePageElement {
  /** 行号 */
  line: number;
  /** 标签名（SearchX / Button / div …） */
  tag: string;
  /** className 上的全部 token */
  tokens: string[];
}

/**
 * 列出首页里所有带 className 的元素
 *
 * 测试要精确指认「哪一颗图标」「哪一个按钮」「哪一圈光晕」时用这个 ——
 * 靠行号会随改动漂移，靠标签名和 token 组合才稳。
 */
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

/* ============================================================
 * CSS 变量
 * ============================================================ */

/** 取某个选择器块的内容（按花括号配对） */
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

/**
 * 读某个作用域里的 --primary-strong 值
 *
 * scope 传 "root" 读 :root，传 "dark" 读 .dark。
 */
export function readPrimaryStrong(
  css: string,
  scope: "root" | "dark"
): string | null {
  const block = extractBlock(css, scope === "dark" ? "\\.dark" : ":root");
  if (!block) return null;
  const m = /--primary-strong:\s*([^;]+);/.exec(block);
  return m ? m[1].trim() : null;
}
