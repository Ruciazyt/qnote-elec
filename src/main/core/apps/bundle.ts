import * as fs from "node:fs";
import * as path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

const EXCLUDED_FILE_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".npmrc",
  "id_rsa",
  "id_ed25519",
  "qnote.json",
]);

const EXCLUDED_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.key$/i,
];

export const DEFAULT_BUNDLE_LIMIT_BYTES = 8 * 1024 * 1024;

export interface BundlePackResult {
  bundle: string;
  fileCount: number;
  bytes: number;
  skipped: string[];
  tooLarge: boolean;
}

function isExcludedFile(relPath: string, name: string): boolean {
  if (EXCLUDED_FILE_NAMES.has(name)) return true;
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function collect(
  root: string,
  relDir: string,
  files: Record<string, string>,
  skipped: string[],
  state: { bytes: number; overflow: boolean; limit: number }
): void {
  if (state.overflow) return;
  const dir = relDir ? path.join(root, relDir) : root;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (state.overflow) return;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        skipped.push(rel);
        continue;
      }
      collect(root, rel, files, skipped, state);
      continue;
    }
    if (!entry.isFile()) {
      skipped.push(rel);
      continue;
    }
    if (isExcludedFile(rel, entry.name)) {
      skipped.push(rel);
      continue;
    }
    let content: Buffer;
    try {
      content = fs.readFileSync(path.join(root, rel));
    } catch {
      skipped.push(rel);
      continue;
    }
    state.bytes += content.byteLength;
    if (state.bytes > state.limit) {
      state.overflow = true;
      return;
    }
    files[rel] = content.toString("base64");
  }
}

export function packProjectBundle(
  root: string,
  limitBytes: number = DEFAULT_BUNDLE_LIMIT_BYTES
): BundlePackResult {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  const state = { bytes: 0, overflow: false, limit: limitBytes };

  collect(root, "", files, skipped, state);

  if (state.overflow) {
    return { bundle: "", fileCount: 0, bytes: state.bytes, skipped, tooLarge: true };
  }

  const json = JSON.stringify(files);
  const bundle = deflateRawSync(Buffer.from(json, "utf8")).toString("base64");
  return {
    bundle,
    fileCount: Object.keys(files).length,
    bytes: state.bytes,
    skipped,
    tooLarge: false,
  };
}

export function unpackProjectBundle(
  root: string,
  bundle: string
): { fileCount: number } {
  if (!bundle) return { fileCount: 0 };
  const json = inflateRawSync(Buffer.from(bundle, "base64")).toString("utf8");
  const files = JSON.parse(json) as Record<string, string>;
  const base = path.resolve(root);
  let count = 0;

  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(base, rel);
    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new Error(`资源包里有越界的路径：${rel}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(content, "base64"));
    count += 1;
  }

  return { fileCount: count };
}
