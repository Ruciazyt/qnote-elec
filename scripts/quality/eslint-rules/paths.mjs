import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function relativePath(context) {
    return path.relative(ROOT, context.filename).replace(/\\/g, "/");
}

export function isTestFile(rel) {
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
}
