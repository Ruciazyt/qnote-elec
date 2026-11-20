import * as fs from "node:fs";
import * as path from "node:path";
import type { AppManifest } from "../../shared/apps/appTypes";
import { normalizePreviewValue } from "../../shared/apps/preview";

export const APP_MANIFEST_FILENAME = "qnote.json";

export interface ManifestParseResult {
  manifest: AppManifest | null;
  error?: string;
  raw?: string;
  missing?: boolean;
}

const MAX_COMMAND_LENGTH = 2000;

export function parseManifestText(text: string): ManifestParseResult {
  const raw = text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { manifest: null, error: `${APP_MANIFEST_FILENAME} 不是合法的 JSON：${detail}`, raw };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      manifest: null,
      error: `${APP_MANIFEST_FILENAME} 的顶层必须是一个对象`,
      raw,
    };
  }

  const source = parsed as Record<string, unknown>;
  const manifest: AppManifest = {};

  if (typeof source.name === "string") {
    const name = source.name.trim();
    if (name) manifest.name = name;
  } else if (source.name !== undefined) {
    return { manifest: null, error: "name 必须是字符串", raw };
  }

  if (typeof source.description === "string") {
    const description = source.description.trim();
    if (description) manifest.description = description;
  } else if (source.description !== undefined) {
    return { manifest: null, error: "description 必须是字符串", raw };
  }

  if (source.command !== undefined) {
    if (typeof source.command !== "string") {
      return { manifest: null, error: "command 必须是字符串", raw };
    }
    const command = source.command.trim();
    if (!command) {
      return { manifest: null, error: "command 不能为空", raw };
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      return { manifest: null, error: "command 太长了", raw };
    }
    manifest.command = command;
  }

  if (source.args !== undefined) {
    if (!Array.isArray(source.args) || source.args.some((a) => typeof a !== "string")) {
      return { manifest: null, error: "args 必须是字符串数组", raw };
    }
    const args = source.args.map((a) => a.trim()).filter((a) => a.length > 0);
    if (args.length > 0) manifest.args = args;
  }

  if (source.cwd !== undefined) {
    if (typeof source.cwd !== "string") {
      return { manifest: null, error: "cwd 必须是字符串", raw };
    }
    const cwd = source.cwd.trim();
    if (cwd) manifest.cwd = cwd;
  }

  if (source.env !== undefined) {
    if (typeof source.env !== "object" || source.env === null || Array.isArray(source.env)) {
      return { manifest: null, error: "env 必须是一个对象", raw };
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(source.env as Record<string, unknown>)) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return { manifest: null, error: `env.${key} 必须是字符串`, raw };
      }
      const name = key.trim();
      if (!name) continue;
      env[name] = String(value);
    }
    if (Object.keys(env).length > 0) manifest.env = env;
  }

  if (source.preview !== undefined) {
    if (typeof source.preview !== "string" && typeof source.preview !== "number") {
      return { manifest: null, error: "preview 必须是端口号或字符串", raw };
    }
    const preview = normalizePreviewValue(source.preview);
    if (preview !== undefined) manifest.preview = preview;
  }

  if (!manifest.command && !manifest.preview) {
    return {
      manifest: null,
      error: `${APP_MANIFEST_FILENAME} 里 command 和 preview 至少要填一个`,
      raw,
    };
  }

  return { manifest, raw };
}

export function readManifestFromDir(dir: string): ManifestParseResult {
  const file = path.join(dir, APP_MANIFEST_FILENAME);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8"); // NOSONAR
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { manifest: null, error: `缺少 ${APP_MANIFEST_FILENAME}`, missing: true };
    }
    return { manifest: null, error: `读取 ${APP_MANIFEST_FILENAME} 失败：${(err as Error).message}` };
  }
  return parseManifestText(text);
}

export function buildCommandLine(manifest: AppManifest): string {
  const parts = [manifest.command ?? ""];
  for (const arg of manifest.args ?? []) {
    parts.push(/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
  }
  return parts.join(" ").trim();
}
