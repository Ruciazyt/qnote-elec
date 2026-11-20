import * as fs from "node:fs";
import * as path from "node:path";
import {
  LEGACY_MANIFEST_FILENAME,
  PLUGIN_MANIFEST_FILENAME,
  parsePluginManifest,
  type ManifestParseResult,
} from "../../shared/plugin/pluginManifest";
import type { PluginManifest } from "../../shared/plugin/pluginTypes";

export {
  LEGACY_MANIFEST_FILENAME,
  PLUGIN_MANIFEST_FILENAME,
  type ManifestParseResult,
};

export function readPluginManifestFromDir(dir: string): ManifestParseResult {
  const file = path.join(dir, PLUGIN_MANIFEST_FILENAME);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8"); // NOSONAR
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { manifest: null, error: `缺少 ${PLUGIN_MANIFEST_FILENAME}`, missing: true };
    }
    return { manifest: null, error: `读取 ${PLUGIN_MANIFEST_FILENAME} 失败：${(err as Error).message}` };
  }
  return parsePluginManifest(text);
}

export function readLegacyManifestFromDir(dir: string): ManifestParseResult | null {
  const file = path.join(dir, LEGACY_MANIFEST_FILENAME);
  if (!fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, "utf-8"); // NOSONAR
    return { manifest: null, raw: text };
  } catch {
    return null;
  }
}

export function writePluginManifestToDir(
  dir: string,
  manifest: PluginManifest
): { ok: boolean; error?: string } {
  try {
    const base = path.resolve(dir);
    if (!fs.existsSync(base)) return { ok: false, error: "插件目录不存在" };
    if (!fs.statSync(base).isDirectory()) return { ok: false, error: "插件路径不是文件夹" };

    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    const parsed = parsePluginManifest(text);
    if (!parsed.manifest) {
      return { ok: false, error: parsed.error ?? "清单内容不合法" };
    }

    fs.writeFileSync(path.join(base, PLUGIN_MANIFEST_FILENAME), text, "utf-8"); // NOSONAR
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
