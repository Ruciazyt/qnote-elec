import { relativePath, isTestFile } from "./paths.mjs";

const SANCTIONED = "src/main/utils/paths.ts";
const RESOURCE = /(^|\/)(preload\.js|package\.json)$/;

export default {
    meta: {
        type: "problem",
        docs: {
            description: "主进程运行期路径必须走 utils/paths.ts，不许手拼资源名",
        },
        schema: [],
        messages: {
            manualPath: "运行期路径别手拼 {{value}}，改用 utils/paths.ts 的 getPreloadPath() / getDevRoot()",
        },
    },
    create(context) {
        const rel = relativePath(context);
        if (!rel.startsWith("src/main/")) return {};
        if (rel === SANCTIONED) return {};
        if (isTestFile(rel)) return {};

        const check = (value, node) => {
            if (typeof value !== "string") return;
            if (!RESOURCE.test(value)) return;
            context.report({ node, messageId: "manualPath", data: { value } });
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
