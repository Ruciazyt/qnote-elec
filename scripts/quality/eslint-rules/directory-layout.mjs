import { relativePath } from "./paths.mjs";

const ROLE_DIRS = [
    {
        dir: "src/main/handlers",
        features: ["ai", "browser", "clipboard", "cloud", "gitlab", "island", "notes", "plugin", "shortcut", "sticky", "system", "todo", "update"],
    },
    {
        dir: "src/main/core",
        features: ["ai", "clipboard", "notes", "plugin", "shortcut", "system", "todo", "update", "window"],
    },
    {
        dir: "src/main/core/window",
        features: ["browser", "clipboard", "island", "plugin", "sticky"],
        topLevel: ["index.ts", "mainWindow.ts", "tray.ts"],
    },
    {
        dir: "src/main/utils",
        flat: true,
    },
    {
        dir: "src/renderer/components",
        features: ["panel", "shell", "ui"],
    },
    {
        dir: "src/renderer/hooks",
        features: ["ai", "browser", "panel", "plugin", "shell", "sticky", "system", "ui"],
    },
    {
        dir: "src/renderer/utils",
        features: ["clipboard", "system"],
    },
    {
        dir: "src/renderer/pages",
        features: ["ai", "browser", "clipboard-popup", "home", "island", "notes", "plugin", "settings", "skills", "sticky", "todo"],
    },
    {
        dir: "src/shared",
        features: ["ai", "clipboard", "cloud", "island", "notes", "plugin", "sticky", "todo"],
    },
    {
        dir: "scripts",
        features: ["build", "dev", "git-hooks", "lib", "migrate", "pixel-pet", "quality", "release"],
        topLevel: ["audit-muted-text.mjs", "check-contrast.mjs", "check-css-text-contrast.mjs"],
    },
];

export default {
    meta: {
        type: "problem",
        docs: {
            description: "角色目录下的文件必须落在功能子目录里，且功能子目录名要在已知清单内",
        },
        schema: [],
        messages: {
            flatFile: "{{dir}} 下的文件必须放进功能子目录，新文件别平铺：{{file}}",
            unknownFeature: "{{dir}}/{{feature}} 不在已知功能目录清单里，确认后加进 scripts/quality/eslint-rules/directory-layout.mjs",
            flatOnly: "{{dir}} 是扁平的，不该有子目录 {{sub}}/ —— 内容归到具体功能模块去",
        },
    },
    create(context) {
        const rel = relativePath(context);
        const match = ROLE_DIRS
            .filter((role) => rel === role.dir || rel.startsWith(role.dir + "/"))
            .sort((a, b) => b.dir.length - a.dir.length)[0];
        if (!match) return {};

        const segments = rel.slice(match.dir.length + 1).split("/");
        const program = context.sourceCode.ast;

        if (match.flat) {
            if (segments.length > 1) {
                context.report({
                    node: program,
                    messageId: "flatOnly",
                    data: { dir: match.dir, sub: segments[0] },
                });
            }
            return {};
        }

        if (segments.length === 1) {
            if ((match.topLevel || []).includes(segments[0])) return {};
            context.report({
                node: program,
                messageId: "flatFile",
                data: { dir: match.dir, file: rel },
            });
            return {};
        }

        if (!match.features.includes(segments[0])) {
            context.report({
                node: program,
                messageId: "unknownFeature",
                data: { dir: match.dir, feature: segments[0] },
            });
        }
        return {};
    },
};
