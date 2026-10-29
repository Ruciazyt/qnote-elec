/**
 * Skill 网络导入 — URL 拉取与解析
 *
 * 支持的输入形式：
 *   1. **JSON 清单 URL**（推荐）
 *      可以是单个 skill 对象，也可以是 skill 数组：
 *      ```json
 *      { "name": "翻译", "content": "翻译成英文：{content}" }
 *      ```
 *      ```json
 *      [ { "name": "...", "content": "..." }, { "name": "...", "content": "..." } ]
 *      ```
 *
 *   2. **纯文本 URL**（当 skill 内容）
 *      URL 返回的纯文本直接作为 content，name 从 URL 文件名推断
 *
 *   3. **GitHub raw 链接**（从 blob URL 自动转 raw）
 *      https://github.com/u/r/blob/main/a.md
 *      → https://raw.githubusercontent.com/u/r/main/a.md
 *
 * 安全约束（重要）：
 *   - 只允许 http/https 协议（挡掉 file:// 和 javascript:）
 *   - 限制响应体大小（防止拉超大文件）
 *   - 超时保护
 *   - 解析结果必须经过 validateSkill 校验才返回
 */

import { validateSkill, SKILL_CATEGORY } from './skill';

export interface ParsedSkill {
  name: string;
  content: string;
}

export interface FetchPreviewResult {
  success: boolean;
  /** 解析出的 skill 列表（待用户确认后入库） */
  skills: ParsedSkill[];
  /** 原始响应（截断预览，给用户看） */
  rawPreview: string;
  /** 失败的 skill（校验不通过） */
  rejected: Array<{ name: string; reason: string }>;
  error?: string;
}

/** 允许的响应体大小上限（200KB，skill 提示词不该更大） */
const MAX_RESPONSE_BYTES = 200 * 1024;

/** 请求超时 */
const FETCH_TIMEOUT_MS = 15_000;

/** 允许的协议 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * 校验 URL 合法性（只允许 http/https）
 */
export function validateUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { ok: false, error: '请输入 URL' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'URL 格式无效' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: `不支持的协议「${parsed.protocol}」，只允许 http / https`,
    };
  }

  return { ok: true, url: parsed };
}

/**
 * GitHub blob URL → raw URL
 * https://github.com/antfu/skills/blob/main/README.md
 *   → https://raw.githubusercontent.com/antfu/skills/main/README.md
 * 其他 URL 原样返回
 */
export function normalizeGitHubUrl(url: URL): URL {
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (url.hostname === 'github.com' && match) {
    const [, owner, repo, path] = match;
    return new URL(
      `https://raw.githubusercontent.com/${owner}/${repo}/${path}`
    );
  }
  return url;
}

/**
 * 从 URL 文件名推断 skill 名
 * https://.../translate-to-english.md → translate-to-english
 */
function inferNameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() || 'imported-skill';
  return last.replace(/\.(md|txt|json)$/i, '') || 'imported-skill';
}

/**
 * 解析响应文本为 skill 列表
 *
 * 判定逻辑：
 *   - 尝试 JSON.parse
 *     - 成功且是数组 → 多个 skill
 *     - 成功且是对象 → 单个 skill（也接受 { skills: [...] } 包装）
 *   - JSON 失败 → 当纯文本，name 从 URL 推断
 */
export function parseSkillPayload(
  text: string,
  url: URL
): { skills: ParsedSkill[]; rejected: Array<{ name: string; reason: string }> } {
  const rejected: Array<{ name: string; reason: string }> = [];
  const trimmed = text.trim();

  // 尝试 JSON
  let parsed: unknown = null;
  let isJson = false;
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      parsed = JSON.parse(trimmed);
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  const candidates: unknown[] = [];

  if (isJson) {
    if (Array.isArray(parsed)) {
      candidates.push(...parsed);
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      // 支持 { skills: [...] } 包装形式
      if (Array.isArray(obj.skills)) {
        candidates.push(...(obj.skills as unknown[]));
      } else {
        candidates.push(obj);
      }
    }
  } else {
    // 纯文本
    candidates.push({
      name: inferNameFromUrl(url),
      content: trimmed,
    });
  }

  const skills: ParsedSkill[] = [];

  for (const c of candidates) {
    if (!c || typeof c !== 'object') {
      rejected.push({ name: '(未知)', reason: '不是有效的对象' });
      continue;
    }
    const obj = c as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : '';
    const content = typeof obj.content === 'string' ? obj.content : '';

    const validation = validateSkill({ name, content });
    if (!validation.valid) {
      rejected.push({ name: name || '(无名称)', reason: validation.error || '校验失败' });
      continue;
    }

    skills.push({ name: name.trim(), content: content.trim() });
  }

  return { skills, rejected };
}

/**
 * 拉取并解析远程 skill（主进程调用）
 */
export async function fetchSkillPreview(rawUrl: string): Promise<FetchPreviewResult> {
  const check = validateUrl(rawUrl);

  if (check.ok === false) {
    return {
      success: false,
      skills: [],
      rawPreview: '',
      rejected: [],
      error: check.error,
    };
  }

  const target = normalizeGitHubUrl(check.url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        // 有些 GitHub raw 端点对空 UA 不友好
        'User-Agent': 'QNote-Skill-Importer/1.0',
        Accept: 'text/plain, application/json, */*',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        skills: [],
        rawPreview: '',
        rejected: [],
        error: `拉取失败：HTTP ${response.status} ${response.statusText}`,
      };
    }

    // 读文本，同时检查大小
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength > MAX_RESPONSE_BYTES) {
      return {
        success: false,
        skills: [],
        rawPreview: '',
        rejected: [],
        error: `内容过大（${Math.round(contentLength / 1024)}KB），上限 ${Math.round(MAX_RESPONSE_BYTES / 1024)}KB`,
      };
    }

    const text = await response.text();

    if (text.length > MAX_RESPONSE_BYTES) {
      return {
        success: false,
        skills: [],
        rawPreview: '',
        rejected: [],
        error: `内容过大，上限 ${Math.round(MAX_RESPONSE_BYTES / 1024)}KB`,
      };
    }

    const { skills, rejected } = parseSkillPayload(text, target);

    if (skills.length === 0) {
      return {
        success: false,
        skills: [],
        rawPreview: text.slice(0, 500),
        rejected,
        error:
          rejected.length > 0
            ? '解析到的内容都不合法'
            : '未解析出任何 skill（需要 JSON 或纯文本）',
      };
    }

    return {
      success: true,
      skills,
      rawPreview: text.slice(0, 500),
      rejected,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? controller.signal.aborted
          ? `拉取超时（${FETCH_TIMEOUT_MS / 1000}s）`
          : err.message
        : String(err);
    return {
      success: false,
      skills: [],
      rawPreview: '',
      rejected: [],
      error: `拉取失败：${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export { SKILL_CATEGORY };
