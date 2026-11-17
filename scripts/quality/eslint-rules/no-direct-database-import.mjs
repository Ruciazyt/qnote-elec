import { relativePath } from "./paths.mjs";

const DATABASE = /(^|\/)database(\/|$)/;

export default {
    meta: {
        type: "problem",
        docs: {
            description: "渲染层与共享层不得直接引数据库，数据只能经主进程 IPC 走",
        },
        schema: [],
        messages: {
            databaseImport: "{{source}} 直接引了数据层，数据访问要经主进程 IPC",
        },
    },
    create(context) {
        const rel = relativePath(context);
        if (!rel.startsWith("src/renderer/") && !rel.startsWith("src/shared/")) return {};

        return {
            ImportDeclaration(node) {
                const source = node.source.value;
                if (typeof source !== "string") return;
                if (!DATABASE.test(source)) return;
                context.report({ node: node.source, messageId: "databaseImport", data: { source } });
            },
        };
    },
};
