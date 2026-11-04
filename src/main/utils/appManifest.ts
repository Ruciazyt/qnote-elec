import * as fs from "node:fs";
import * as path from "node:path";
import type { AppManifest } from "../../shared/appTypes";

/**
 * 项目清单文件名 —— 规范里约定的唯一入口文件
 *
 * 放在项目根目录（与 qnote.json 同级的是被管理的项目产物）。
 */
export const APP_MANIFEST_FILENAME = "qnote.json";

/** 清单解析结果 */
export interface ManifestParseResult {
  /** 规范化后的清单；解析失败为 null */
  manifest: AppManifest | null;
  /** 失败原因（中文，可直接展示给用户） */
  error?: string;
  /** 清单原文 */
  raw?: string;
  /**
   * 是否是「根本没有这个文件」
   *
   * 单独给一个标志，而不是让调用方去比对 error 文案 ——
   * 文案一改，比对就悄悄失效，缺清单的项目会被误判成「清单有误」。
   */
  missing?: boolean;
}

/** 命令里允许出现的最长长度 —— 防止异常清单把命令行撑爆 */
const MAX_COMMAND_LENGTH = 2000;

/**
 * 校验并规范化一份清单文本
 *
 * ## 为什么要单独一个纯函数
 *
 * 清单是用户自己写的 JSON，出错方式五花八门：少个引号、command 写成数组、
 * env 里混进数字……每个错误分支都要给一句用户看得懂的话。把这些判断从
 * 目录扫描里拆出来，既能单独测，也不会让扫描函数变成一堆 if。
 *
 * ## 规范化做了什么
 *
 * - 未知字段直接丢弃（以后加字段不会让老清单失效）
 * - 所有字符串去首尾空白
 * - `command` 与 `args` 校验：command 必须是非空字符串，args 必须全是字符串
 * - `env` 的值必须是字符串（数字会被转成字符串，避免 spawn 收到非法 env）
 */
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

  // name
  if (typeof source.name === "string") {
    const name = source.name.trim();
    if (name) manifest.name = name;
  } else if (source.name !== undefined) {
    return { manifest: null, error: "name 必须是字符串", raw };
  }

  // description
  if (typeof source.description === "string") {
    const description = source.description.trim();
    if (description) manifest.description = description;
  } else if (source.description !== undefined) {
    return { manifest: null, error: "description 必须是字符串", raw };
  }

  // command
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

  // args
  if (source.args !== undefined) {
    if (!Array.isArray(source.args) || source.args.some((a) => typeof a !== "string")) {
      return { manifest: null, error: "args 必须是字符串数组", raw };
    }
    const args = source.args.map((a) => a.trim()).filter((a) => a.length > 0);
    if (args.length > 0) manifest.args = args;
  }

  // cwd
  if (source.cwd !== undefined) {
    if (typeof source.cwd !== "string") {
      return { manifest: null, error: "cwd 必须是字符串", raw };
    }
    const cwd = source.cwd.trim();
    if (cwd) manifest.cwd = cwd;
  }

  // env
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

  // preview
  if (source.preview !== undefined) {
    if (typeof source.preview !== "string") {
      return { manifest: null, error: "preview 必须是字符串", raw };
    }
    const preview = source.preview.trim();
    if (preview) manifest.preview = preview;
  }

  // 至少要有一件事可做 —— 两者都没有的项目，加进来也没有任何意义
  if (!manifest.command && !manifest.preview) {
    return {
      manifest: null,
      error: `${APP_MANIFEST_FILENAME} 里 command 和 preview 至少要填一个`,
      raw,
    };
  }

  return { manifest, raw };
}

/**
 * 读取一个目录下的清单
 *
 * 目录不存在 / 清单文件不存在都返回「缺清单」，由调用方决定怎么展示 ——
 * 这两种情况在界面上的表现都是「这个文件夹还不是一个可管理的项目」。
 */
export function readManifestFromDir(dir: string): ManifestParseResult {
  const file = path.join(dir, APP_MANIFEST_FILENAME);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { manifest: null, error: `缺少 ${APP_MANIFEST_FILENAME}`, missing: true };
    }
    return { manifest: null, error: `读取 ${APP_MANIFEST_FILENAME} 失败：${(err as Error).message}` };
  }
  return parseManifestText(text);
}

/**
 * 拼出最终执行的命令行
 *
 * args 里带空格的参数会被加引号 —— 否则 `node server.js --title 我的 应用`
 * 会被 shell 拆成三个参数。
 */
export function buildCommandLine(manifest: AppManifest): string {
  const parts = [manifest.command ?? ""];
  for (const arg of manifest.args ?? []) {
    parts.push(/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
  }
  return parts.join(" ").trim();
}
