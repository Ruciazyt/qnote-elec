import { relativePath } from "./paths.mjs";

const ARBITRARY_DURATION = /\bduration-\[/;

export default {
    meta: {
        type: "problem",
        docs: {
            description: "禁止 Tailwind 任意值时长类名：duration-[...] 判为歧义，规则根本不会生成",
        },
        schema: [],
        messages: {
            arbitraryDuration: "别用 {{value}}，任意值时长会被判歧义直接跳过；改用 tailwind.config.js 里登记的命名档位",
        },
    },
    create(context) {
        const rel = relativePath(context);
        if (!rel.startsWith("src/renderer/")) return {};

        const check = (value, node) => {
            if (typeof value !== "string") return;
            const match = value.match(/\bduration-\[[^\]]*\]/);
            if (!match) return;
            context.report({ node, messageId: "arbitraryDuration", data: { value: match[0] } });
        };

        return {
            Literal(node) {
                check(node.value, node);
            },
            TemplateElement(node) {
                check(node.value.raw, node);
            },
        };
    },
};
