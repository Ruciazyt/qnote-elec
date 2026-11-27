import { isTestFile, relativePath } from "./paths.mjs";

const MAX_FILE_LINES = 300;
const MAX_STATE_HOOKS = 3;
const MAX_EFFECT_HOOKS = 2;

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

function componentName(node) {
    const name = node.id?.name ?? node.parent?.id?.name ?? "";
    return /^[A-Z]/.test(name) ? name : null;
}

function hookName(node) {
    if (node.type !== "CallExpression") return null;
    const callee = node.callee;
    if (callee.type === "Identifier") return callee.name;
    if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.object.name === "React" &&
        callee.property.type === "Identifier"
    ) {
        return callee.property.name;
    }
    return null;
}

export default {
    meta: {
        type: "suggestion",
        docs: {
            description: "限制 React 文件与组件边界，防止页面组件持续膨胀",
        },
        schema: [],
        messages: {
            fileTooLong: "React 文件有 {{lines}} 行，超过 {{max}} 行上限，请按功能拆到同域子目录",
            tooManyStates: "组件 {{name}} 使用了 {{count}} 个 useState，超过 {{max}} 个上限，请把状态逻辑收进自定义 hook",
            tooManyEffects: "组件 {{name}} 使用了 {{count}} 个 useEffect，超过 {{max}} 个上限，请把副作用编排收进自定义 hook",
        },
    },
    create(context) {
        const rel = relativePath(context);
        if (
            isTestFile(rel) ||
            !rel.startsWith("src/renderer/") ||
            !rel.endsWith(".tsx")
        ) {
            return {};
        }

        const components = new Map();
        const register = (name, value) => {
            const fn = resolveFunction(value);
            if (fn && /^[A-Z]/.test(name)) components.set(fn, name);
        };

        const countHooks = (root, expectedName) => {
            const counts = { useState: 0, useEffect: 0 };
            const visit = (node) => {
                if (!node || typeof node !== "object") return;
                if (node !== root && (
                    node.type === "FunctionDeclaration" ||
                    node.type === "FunctionExpression" ||
                    node.type === "ArrowFunctionExpression"
                )) {
                    return;
                }
                const name = hookName(node);
                if (name === "useState" || name === "useEffect") counts[name] += 1;
                const visitorKeys = context.sourceCode.visitorKeys[node.type] ?? [];
                for (const key of visitorKeys) {
                    const child = node[key];
                    if (Array.isArray(child)) {
                        for (const item of child) visit(item);
                    } else {
                        visit(child);
                    }
                }
            };
            visit(root.body);
            return {
                ...counts,
                name: expectedName ?? componentName(root) ?? "匿名组件",
            };
        };

        return {
            FunctionDeclaration(node) {
                register(node.id?.name ?? "", node);
            },
            VariableDeclarator(node) {
                if (node.id.type === "Identifier") register(node.id.name, node.init);
            },
            ExportDefaultDeclaration(node) {
                const fn = resolveFunction(node.declaration);
                if (fn) components.set(fn, componentName(fn) ?? "默认组件");
            },
            "Program:exit"(node) {
                const lines = context.sourceCode.lines.length;
                if (lines > MAX_FILE_LINES) {
                    context.report({
                        node,
                        messageId: "fileTooLong",
                        data: { lines, max: MAX_FILE_LINES },
                    });
                }

                for (const [component, name] of components) {
                    const counts = countHooks(component, name);
                    if (counts.useState > MAX_STATE_HOOKS) {
                        context.report({
                            node: component,
                            messageId: "tooManyStates",
                            data: {
                                name,
                                count: counts.useState,
                                max: MAX_STATE_HOOKS,
                            },
                        });
                    }
                    if (counts.useEffect > MAX_EFFECT_HOOKS) {
                        context.report({
                            node: component,
                            messageId: "tooManyEffects",
                            data: {
                                name,
                                count: counts.useEffect,
                                max: MAX_EFFECT_HOOKS,
                            },
                        });
                    }
                }
            },
        };
    },
};
