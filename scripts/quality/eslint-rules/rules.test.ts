import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "eslint";
import qnote from "./index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const file = (rel: string) => path.join(ROOT, rel);

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const rules = qnote.rules as Record<string, any>;

ruleTester.run("qnote/directory-layout", rules["directory-layout"], {
    valid: [
        { filename: file("src/main/handlers/notes/noteHandlers.ts"), code: "export const a = 1;" },
        { filename: file("src/main/core/window/mainWindow.ts"), code: "export const a = 1;" },
        { filename: file("src/main/core/window/tray.ts"), code: "export const a = 1;" },
        { filename: file("src/renderer/pages/notes/NoteFileList.tsx"), code: "export const a = 1;" },
        { filename: file("src/renderer/pages/notes/editors/HtmlViewer.tsx"), code: "export const a = 1;" },
        { filename: file("src/shared/notes/noteTypes.ts"), code: "export const a = 1;" },
        { filename: file("scripts/quality/sonar-issues.js"), code: "module.exports = 1;" },
        { filename: file("src/database/index.ts"), code: "export const a = 1;" },
        { filename: file("src/main/utils/paths.ts"), code: "export const a = 1;" },
    ],
    invalid: [
        {
            filename: file("src/main/handlers/noteHandlers.ts"),
            code: "export const a = 1;",
            errors: [{ messageId: "flatFile" }],
        },
        {
            filename: file("src/renderer/components/BrandNew/Widget.tsx"),
            code: "export const a = 1;",
            errors: [{ messageId: "unknownFeature" }],
        },
        {
            filename: file("scripts/loose-tool.mjs"),
            code: "export const a = 1;",
            errors: [{ messageId: "flatFile" }],
        },
        {
            filename: file("src/main/utils/ai/oldPlace.ts"),
            code: "export const a = 1;",
            errors: [{ messageId: "flatOnly" }],
        },
    ],
});

ruleTester.run("qnote/no-manual-runtime-path", rules["no-manual-runtime-path"], {
    valid: [
        { filename: file("src/main/core/window/mainWindow.ts"), code: 'log.info("preload.js存在:");' },
        { filename: file("src/main/utils/paths.ts"), code: 'const p = "dist/main/preload.js";' },
        { filename: file("src/main/utils/paths.test.ts"), code: 'const p = "preload.js";' },
        { filename: file("src/main/handlers/notes/noteHandlers.ts"), code: 'const p = "notes.json";' },
    ],
    invalid: [
        {
            filename: file("src/main/core/window/mainWindow.ts"),
            code: 'const p = "preload.js";',
            errors: [{ messageId: "manualPath" }],
        },
        {
            filename: file("src/main/handlers/system/configHandlers.ts"),
            code: 'const p = path.join(root, "package.json");',
            errors: [{ messageId: "manualPath" }],
        },
    ],
});

ruleTester.run("qnote/preload-no-shared-import", rules["preload-no-shared-import"], {
    valid: [
        { filename: file("src/main/handlers/notes/noteHandlers.ts"), code: 'import x from "../shared/notes/noteTypes";' },
        { filename: file("src/main/preload.ts"), code: 'const { ipcRenderer } = require("electron");' },
    ],
    invalid: [
        {
            filename: file("src/main/preload.ts"),
            code: 'import x from "../shared/notes/noteTypes";',
            errors: [{ messageId: "sharedImport" }],
        },
        {
            filename: file("src/main/preload.ts"),
            code: 'const x = require("../shared/island/island");',
            errors: [{ messageId: "sharedImport" }],
        },
    ],
});

ruleTester.run("qnote/no-direct-database-import", rules["no-direct-database-import"], {
    valid: [
        { filename: file("src/renderer/pages/notes/NotesPage.tsx"), code: 'import x from "@shared/notes/noteTypes";' },
        { filename: file("src/main/core/notes/noteStore.ts"), code: 'import x from "../../../database/index";' },
    ],
    invalid: [
        {
            filename: file("src/renderer/pages/notes/NotesPage.tsx"),
            code: 'import x from "../../../database/index";',
            errors: [{ messageId: "databaseImport" }],
        },
        {
            filename: file("src/shared/notes/noteTypes.ts"),
            code: 'import x from "../../database/cloud/cloudManager";',
            errors: [{ messageId: "databaseImport" }],
        },
    ],
});

ruleTester.run("qnote/no-module-state-in-utils", rules["no-module-state-in-utils"], {
    valid: [
        { filename: file("src/main/utils/providers.ts"), code: 'export const PROVIDERS = new Set(["openai"]);' },
        { filename: file("src/main/utils/clipboard.ts"), code: "export function pick() { const local = new Map(); return local; }" },
        { filename: file("src/main/utils/assets.ts"), code: 'const ALLOWED = new Set(["http:"]); export const ok = (u) => ALLOWED.has(u);' },
        { filename: file("src/main/core/ai/toolContext.ts"), code: "let _ctx = null; export const get = () => _ctx;" },
        { filename: file("src/main/utils/externalUrl.ts"), code: 'const ALLOWED = new Set(["http:"]); export const ok = (u) => ALLOWED.has(u);' },
    ],
    invalid: [
        {
            filename: file("src/main/utils/oldState.ts"),
            code: 'let API_KEY = ""; export const set = (k) => { API_KEY = k; };',
            errors: [{ messageId: "moduleLet" }],
        },
        {
            filename: file("src/main/utils/cache.ts"),
            code: "const cache = new Map(); cache.set(1, 2); export const c = cache;",
            errors: [{ messageId: "moduleCollection" }],
        },
        {
            filename: file("src/main/utils/store.ts"),
            code: "let db = null; export const init = (d) => { db = d; };",
            errors: [{ messageId: "moduleLet" }],
        },
        {
            filename: file("src/main/utils/logger.ts"),
            code: "class Logger {}\nexport const log = new Logger();",
            errors: [{ messageId: "sharedInstance" }],
        },
    ],
});

ruleTester.run("qnote/no-arbitrary-duration", rules["no-arbitrary-duration"], {
    valid: [
        { filename: file("src/renderer/components/panel/ResizableSidebar.tsx"), code: 'const c = "duration-panel";' },
        { filename: file("src/renderer/components/panel/ResizableSidebar.tsx"), code: 'const c = "transitionDuration-[220ms]";' },
        { filename: file("src/renderer/components/panel/ResizableSidebar.tsx"), code: 'const c = "duration-200";' },
    ],
    invalid: [
        {
            filename: file("src/renderer/components/panel/ResizableSidebar.tsx"),
            code: 'const c = "duration-[220ms]";',
            errors: [{ messageId: "arbitraryDuration" }],
        },
        {
            filename: file("src/renderer/pages/notes/NotesPage.tsx"),
            code: 'const c = "hover:duration-[1.2s] ease-out";',
            errors: [{ messageId: "arbitraryDuration" }],
        },
    ],
});
