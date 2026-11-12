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
 *   3. **SKILL.md**（带 YAML frontmatter）
 *      ```markdown
 *      ---
 *      name: pdf-converter
 *      description: "PDF 转 Markdown / OCR …"
 *      ---
 *      # 正文 …
 *      ```
 *      frontmatter 的 name 作为技能名，description 作为正文前缀
 *
 *   4. **GitHub 链接自动转换**
 *      - blob 链接 → raw
 *        https://github.com/u/r/blob/main/a.md
 *        → https://raw.githubusercontent.com/u/r/main/a.md
 *      - 仓库根链接 / 目录链接 → 仓库里的 SKILL.md（没有则 README.md）
 *        https://github.com/u/r → 仓库里的 SKILL.md
 *
 * 安全约束（重要）：
 *   - 只允许 http/https 协议（挡掉 file:// 和 javascript:）
 *   - 超时保护
 *   - 抓到 HTML 网页时直接报错（别把整页网页当技能导进去）
 *   - 解析结果必须经过 validateSkill 校验才返回
 *
 * 体积：**不限制响应体大小** —— skill 提示词动辄上万字，
 * 早期那个 200KB 上限会把正常的 SKILL.md 直接挡在门外。
 */

import { validateSkill, SKILL_CATEGORY, MAX_SKILL_NAME_LENGTH } from './skill';

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

/** 请求超时（整条解析链路共用一个时间预算） */
const FETCH_TIMEOUT_MS = 15_000;

/** 允许的协议 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** 请求头 —— GitHub API 要求带 User-Agent */
const REQUEST_HEADERS = {
  'User-Agent': 'QNote-Skill-Importer/1.0',
  Accept: 'text/plain, application/json, */*',
};

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

/** 仓库位置（GitHub 仓库根链接 / 目录链接） */
interface GithubLocation {
  owner: string;
  repo: string;
  /** 目录路径，仓库根为空串 */
  dir: string;
  /** 链接里显式指定的分支 */
  ref?: string;
}

/**
 * 从 github.com 链接里解析仓库位置
 *
 *   /owner/repo                 → 仓库根
 *   /owner/repo/tree/main/sub   → 仓库内某个目录
 *   /owner/repo/blob/main/x.md  → 文件（返回 null，走 raw 转换）
 */
function parseGithubLocation(url: URL): GithubLocation | null {
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');

  if (segments.length === 2) {
    return { owner, repo, dir: '' };
  }
  if (segments[2] === 'tree' && segments.length >= 3) {
    return {
      owner,
      repo,
      ref: segments[3],
      dir: segments.slice(4).join('/'),
    };
  }
  return null;
}

/**
 * 抓一个 URL 的文本内容 —— 不限制体积
 */
async function fetchText(
  url: string,
  signal: AbortSignal
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, { signal, headers: REQUEST_HEADERS });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    return { ok: true, text: await response.text() };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, error: '请求超时' };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 在仓库里定位技能文件
 *
 * 先走 GitHub Contents API（一次拿到文件列表 + 默认分支），
 * 优先 SKILL.md，没有就 README.md；API 不可用时退回猜 raw 路径。
 */
async function resolveGithubSkillFile(
  loc: GithubLocation,
  signal: AbortSignal
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const apiUrl =
    `https://api.github.com/repos/${loc.owner}/${loc.repo}/contents/${loc.dir}` +
    (loc.ref ? `?ref=${encodeURIComponent(loc.ref)}` : '');

  const api = await fetchText(apiUrl, signal);
  if (api.ok) {
    try {
      const entries = JSON.parse(api.text);
      if (Array.isArray(entries)) {
        const byName = (wanted: string) =>
          entries.find(
            (e: any) =>
              e?.type === 'file' &&
              String(e?.name || '').toUpperCase() === wanted
          );
        const hit = byName('SKILL.MD') || byName('README.MD');
        if (hit?.download_url) {
          return { ok: true, url: String(hit.download_url) };
        }
        return {
          ok: false,
          error: `仓库里没有 SKILL.md 或 README.md（目录：${loc.dir || '根目录'}）`,
        };
      }
      if (entries?.message) {
        return { ok: false, error: `GitHub API：${entries.message}` };
      }
    } catch {
      // 返回的不是预期 JSON → 走下面的 raw 兜底
    }
  }

  // 兜底：直接猜 raw 路径
  const refs = [...new Set([loc.ref, 'main', 'master'].filter(Boolean) as string[])];
  const base = loc.dir ? `${loc.dir}/` : '';
  for (const ref of refs) {
    const candidate = `https://raw.githubusercontent.com/${loc.owner}/${loc.repo}/${ref}/${base}SKILL.md`;
    const res = await fetchText(candidate, signal);
    if (res.ok) {
      return { ok: true, url: candidate };
    }
  }
  return { ok: false, error: '没能在仓库里找到 SKILL.md' };
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
 * 拆出 YAML frontmatter（只认简单的 key: value，不引 YAML 库）
 */
function extractFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { meta: {}, body: normalized };
  }
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    return { meta: {}, body: normalized };
  }

  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^[^\n]*\n?/, '');

  const meta: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[m[1].toLowerCase()] = value;
  }
  return { meta, body };
}

/**
 * 判断抓到的是不是网页 HTML
 */
function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 300).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/**
 * 解析响应文本为 skill 列表
 *
 * 判定逻辑：
 *   - 尝试 JSON.parse
 *     - 成功且是数组 → 多个 skill
 *     - 成功且是对象 → 单个 skill（也接受 { skills: [...] } 包装）
 *   - JSON 失败 → 看有没有 YAML frontmatter
 *     - 有 name → 单个 skill（name 取 frontmatter，description 作为正文前缀）
 *   - 都没有 → 当纯文本，name 从 URL 推断
 *
 * @param fallbackName 仓库链接解析出来的备用名（仓库名）
 */
export function parseSkillPayload(
  text: string,
  url: URL,
  fallbackName?: string
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
    // 纯文本 / SKILL.md
    const { meta, body } = extractFrontmatter(text);
    const name = meta.name || fallbackName || inferNameFromUrl(url);
    const description = meta.description || '';
    const content = description ? `${description}\n\n${body.trim()}` : body.trim();
    candidates.push({ name, content });
  }

  const skills: ParsedSkill[] = [];

  for (const c of candidates) {
    if (!c || typeof c !== 'object') {
      rejected.push({ name: '(未知)', reason: '不是有效的对象' });
      continue;
    }
    const obj = c as Record<string, unknown>;
    const rawName = typeof obj.name === 'string' ? obj.name : '';
    const content = typeof obj.content === 'string' ? obj.content : '';

    // 名字超长就截断，不因为名字把整条导入挡掉
    const name = rawName.trim().slice(0, MAX_SKILL_NAME_LENGTH);

    const validation = validateSkill({ name, content });
    if (!validation.valid) {
      rejected.push({ name: name || '(无名称)', reason: validation.error || '校验失败' });
      continue;
    }

    skills.push({ name, content: content.trim() });
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // GitHub 仓库链接 / 目录链接 → 先在仓库里找到技能文件
    const loc = parseGithubLocation(check.url);
    let target = check.url;
    let fallbackName = '';

    if (loc) {
      const resolved = await resolveGithubSkillFile(loc, controller.signal);
      if (resolved.ok === false) {
        return {
          success: false,
          skills: [],
          rawPreview: '',
          rejected: [],
          error: resolved.error,
        };
      }
      target = new URL(resolved.url);
      fallbackName = loc.repo;
    } else {
      target = normalizeGitHubUrl(check.url);
    }

    const res = await fetchText(target.toString(), controller.signal);
    if (res.ok === false) {
      return {
        success: false,
        skills: [],
        rawPreview: '',
        rejected: [],
        error: `拉取失败：${res.error}`,
      };
    }

    const text = res.text;

    // 抓到的是网页就别导了 —— 整页 HTML 当技能没有任何意义
    if (looksLikeHtml(text)) {
      return {
        success: false,
        skills: [],
        rawPreview: '',
        rejected: [],
        error:
          '抓到的是网页 HTML，不是技能内容。请提供文件链接（GitHub 的 blob 链接 / raw 地址）或仓库链接。',
      };
    }

    const { skills, rejected } = parseSkillPayload(text, target, fallbackName);

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
