import { relativePath } from "./paths.mjs";

const MUTATORS = new Set(["set", "add", "delete", "clear"]);
const COLLECTIONS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

export default {
    meta: {
        type: "problem",
        docs: {
            description: "utils 只放纯逻辑：模块级可变状态（进程级单例）属于 core",
        },
        schema: [],
        messages: {
            moduleLet: "utils 里不许有模块级可变状态：{{name}} 是进程级单例，该放进 core/<功能>/",
            moduleCollection: "utils 里不许有模块级可变缓存：{{name}} 会被改，该放进 core/<功能>/",
            sharedInstance: "utils 里不许有共享单例：{{name}} 是导出的模块级实例，该放进 core/<功能>/",
        },
    },
    create(context) {
        const rel = relativePath(context);
        if (!rel.startsWith("src/main/utils/")) return {};

        const lets = [];
        const instances = [];
        const collections = new Map();
        const mutated = new Set();

        return {
            Program(node) {
                const handle = (varDecl, exported) => {
                    for (const d of varDecl.declarations) {
                        if (d.id.type !== "Identifier") continue;
                        if (varDecl.kind === "let") {
                            lets.push(d);
                            continue;
                        }
                        if (varDecl.kind !== "const") continue;
                        const init = d.init;
                        if (!init || init.type !== "NewExpression") continue;
                        const callee = init.callee;
                        if (callee.type !== "Identifier") continue;
                        if (COLLECTIONS.has(callee.name)) {
                            collections.set(d.id.name, d);
                            continue;
                        }
                        if (exported) instances.push(d);
                    }
                };
                for (const stmt of node.body) {
                    if (stmt.type === "ExportNamedDeclaration") {
                        if (stmt.declaration && stmt.declaration.type === "VariableDeclaration") {
                            handle(stmt.declaration, true);
                        }
                        continue;
                    }
                    if (stmt.type === "VariableDeclaration") handle(stmt, false);
                }
            },
            MemberExpression(node) {
                if (node.object.type !== "Identifier") return;
                if (!collections.has(node.object.name)) return;
                if (node.property.type !== "Identifier") return;
                if (!MUTATORS.has(node.property.name)) return;
                mutated.add(node.object.name);
            },
            "Program:exit"() {
                for (const d of lets) {
                    context.report({
                        node: d,
                        messageId: "moduleLet",
                        data: { name: d.id.name },
                    });
                }
                for (const d of instances) {
                    context.report({
                        node: d,
                        messageId: "sharedInstance",
                        data: { name: d.id.name },
                    });
                }
                for (const [name, d] of collections) {
                    if (!mutated.has(name)) continue;
                    context.report({
                        node: d,
                        messageId: "moduleCollection",
                        data: { name },
                    });
                }
            },
        };
    },
};
