import { relativePath } from "./paths.mjs";

const TARGET = "src/main/preload.ts";
const SHARED = /^(?:\.\.\/)+shared\//;

export default {
    meta: {
        type: "problem",
        docs: {
            description: "preload 不能 import src/shared —— preload 的 tsconfig 把 rootDir 卡在 src/main",
        },
        schema: [],
        messages: {
            sharedImport: "preload 不能引入共享层 {{source}}，共享类型复制一份或在主进程里中转",
        },
    },
    create(context) {
        const rel = relativePath(context);
        if (rel !== TARGET) return {};

        const check = (source, node) => {
            if (typeof source !== "string") return;
            if (!SHARED.test(source) && !source.startsWith("@shared/")) return;
            context.report({ node, messageId: "sharedImport", data: { source } });
        };

        return {
            ImportDeclaration(node) {
                check(node.source.value, node.source);
            },
            CallExpression(node) {
                if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
                const arg = node.arguments[0];
                if (!arg || arg.type !== "Literal") return;
                check(arg.value, arg);
            },
        };
    },
};
