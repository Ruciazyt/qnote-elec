
import { validateSkill, MAX_SKILL_NAME_LENGTH } from "./skill";


export interface ParsedSkill {
  name: string;
  content: string;
}

export interface FetchPreviewResult {
  success: boolean;
  skills: ParsedSkill[];
  rawPreview: string;
  rejected: Array<{ name: string; reason: string }>;
  error?: string;
}

const FETCH_TIMEOUT_MS = 15_000;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const REQUEST_HEADERS = {
  'User-Agent': 'QNote-Skill-Importer/1.0',
  Accept: 'text/plain, application/json, */*',
};

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

interface GithubLocation {
  owner: string;
  repo: string;
  dir: string;
  ref?: string;
}

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
    }
  }

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

function inferNameFromUrl(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).pop() || 'imported-skill';
  return last.replace(/\.(md|txt|json)$/i, '') || 'imported-skill';
}

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
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trimEnd();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key.toLowerCase()] = value;
  }
  return { meta, body };
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 300).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

export function parseSkillPayload(
  text: string,
  url: URL,
  fallbackName?: string
): { skills: ParsedSkill[]; rejected: Array<{ name: string; reason: string }> } {
  const rejected: Array<{ name: string; reason: string }> = [];
  const trimmed = text.trim();

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
      if (Array.isArray(obj.skills)) {
        candidates.push(...(obj.skills as unknown[]));
      } else {
        candidates.push(obj);
      }
    }
  } else {
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
    const loc = parseGithubLocation(check.url);
    let target: URL;
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

export { SKILL_CATEGORY } from "./skill";
