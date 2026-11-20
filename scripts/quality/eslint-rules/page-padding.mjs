import { isTestFile, relativePath } from "./paths.mjs";

const PAGE_PADDING_X = "px-6";
const PAGE_PADDING_Y = "py-8";
const PAGE_HEADER_GAP = "mb-8";

const PAGE_FILE = /^src\/renderer\/pages\/[a-z0-9-]+\/[A-Z][A-Za-z0-9]*Page\.tsx$/;

const PX = /^(?:[a-z0-9]+:)*px-.+$/;
const PY = /^(?:[a-z0-9]+:)*py-.+$/;
const P_ALL = /^(?:[a-z0-9]+:)*p-[\d.]+$/;
const MB = /^(?:[a-z0-9]+:)*mb-.+$/;

function classAttribute(node) {
    return node.openingElement.attributes.find(
        (attr) => attr.type === "JSXAttribute" && attr.name.name === "className"
    );
}

function staticClassText(attr) {
    if (!attr || !attr.value) return null;
    const value = attr.value;
    if (value.type === "Literal" && typeof value.value === "string") return value.value;
    if (value.type === "JSXExpressionContainer") {
        const expr = value.expression;
        if (expr.type === "Literal" && typeof expr.value === "string") return expr.value;
        if (expr.type === "TemplateLiteral") {
            return expr.quasis.map((q) => q.value.cooked ?? q.value.raw ?? "").join(" ");
        }
    }
    return null;
}

function classTokens(node) {
    const text = staticClassText(classAttribute(node));
    if (text === null) return null;
    return text.split(/\s+/).filter(Boolean);
}

function jsxRoots(node) {
    if (!node) return [];
    if (node.type === "JSXElement") return [node];
    if (node.type === "ConditionalExpression") {
        return [...jsxRoots(node.consequent), ...jsxRoots(node.alternate)];
    }
    if (node.type === "LogicalExpression") {
        return [...jsxRoots(node.left), ...jsxRoots(node.right)];
    }
    if (node.type === "SequenceExpression") {
        return node.expressions.flatMap(jsxRoots);
    }
    if (node.type === "ParenthesizedExpression") return jsxRoots(node.expression);
    return [];
}

function resolveFunction(node) {
    if (!node) return null;
    if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
    ) {
        return node;
    }
    if (node.type === "CallExpression") return resolveFunction(node.arguments[0]);
    return null;
}

function returnedElements(fn) {
    const body = fn.body;
    if (!body) return [];
    if (body.type !== "BlockStatement") return jsxRoots(body);
    return body.body.flatMap((stmt) =>
        stmt.type === "ReturnStatement" ? jsxRoots(stmt.argument) : []
    );
}

export default {
    meta: {
        type: "problem",
        docs: {
            description: "页面边距必须是登记档：页面容器 px-6 py-8，页头下间距 mb-8",
        },
        schema: [],
        messages: {
            pagePaddingX: "页面容器水平边距必须是 {{expected}}，别写 {{actual}}",
            pagePaddingY: "页面容器垂直边距必须是 {{expected}}，别写 {{actual}}",
            pagePaddingAll: "页面容器别用 {{actual}} 四边内边距，改成 {{expected}}",
            pagePaddingMissing: "页面容器必须同时写 {{expected}}，现在只写了 {{actual}}",
            pageHeaderGap: "页头下间距必须是 {{expected}}，别写 {{actual}}",
            pageHeaderGapMissing: "页头下间距必须是 {{expected}}，现在没写",
        },
    },
    create(context) {
        const rel = relativePath(context);
        if (isTestFile(rel) || !PAGE_FILE.test(rel)) return {};

        const report = (node, messageId, expected, actual) => {
            context.report({ node, messageId, data: { expected, actual } });
        };

        const checkContainer = (element) => {
            const tokens = classTokens(element);
            if (!tokens) return;

            const px = tokens.filter((t) => PX.test(t));
            const py = tokens.filter((t) => PY.test(t));
            const pAll = tokens.filter((t) => P_ALL.test(t));

            if (pAll.length) {
                report(element, "pagePaddingAll", `${PAGE_PADDING_X} ${PAGE_PADDING_Y}`, pAll.join(" "));
                return;
            }
            if (!px.length && !py.length) return;

            const badPx = px.filter((t) => t !== PAGE_PADDING_X);
            if (badPx.length) {
                report(element, "pagePaddingX", PAGE_PADDING_X, badPx.join(" "));
            }
            const badPy = py.filter((t) => t !== PAGE_PADDING_Y);
            if (badPy.length) {
                report(element, "pagePaddingY", PAGE_PADDING_Y, badPy.join(" "));
            }
            if (!px.length || !py.length) {
                report(
                    element,
                    "pagePaddingMissing",
                    `${PAGE_PADDING_X} ${PAGE_PADDING_Y}`,
                    px.length ? px.join(" ") : py.join(" ")
                );
            }
        };

        const checkHeader = (element) => {
            if (!classAttribute(element)) {
                report(element, "pageHeaderGapMissing", PAGE_HEADER_GAP, "未设置");
                return;
            }
            const tokens = classTokens(element);
            if (!tokens) return;
            const gaps = tokens.filter((t) => MB.test(t));
            if (!gaps.length) {
                report(element, "pageHeaderGapMissing", PAGE_HEADER_GAP, "未设置");
                return;
            }
            const bad = gaps.filter((t) => t !== PAGE_HEADER_GAP);
            if (bad.length) {
                report(element, "pageHeaderGap", PAGE_HEADER_GAP, bad.join(" "));
            }
        };

        return {
            JSXElement(node) {
                const name = node.openingElement.name;
                if (name.type === "JSXIdentifier" && name.name === "PageHeader") {
                    checkHeader(node);
                }
            },
            ExportDefaultDeclaration(node) {
                const fn = resolveFunction(node.declaration);
                if (!fn) return;
                for (const element of returnedElements(fn)) {
                    checkContainer(element);
                }
            },
        };
    },
};
