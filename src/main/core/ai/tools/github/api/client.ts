import { getGithubLogger } from '../runtime/runtime';
import { getGithubConfig } from '../runtime/config';
import { describeStatus, isRateLimited } from './errors';
import { githubEndpoints } from './endpoints';

export { describeStatus } from './errors';
export { encodeRepositoryId } from './endpoints';

const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 60000;

export class GithubApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(message: string, status: number, retryable: boolean, detail?: string) {
    super(message);
    this.name = 'GithubApiError';
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

export type GithubQueryValue = string | number | boolean | undefined;

export interface GithubRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, GithubQueryValue>;
  body?: unknown;
  raw?: boolean;
  idempotent?: boolean;
}

export interface GithubResult<T> {
  data: T;
  headers: Record<string, string>;
}

export interface GithubPage<T> {
  items: T[];
  nextPage: number | null;
  total: number | null;
}

export interface GithubLink {
  nextPage: number | null;
  lastPage: number | null;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, GithubQueryValue>
): string {
  const suffix = path.startsWith('/') ? path : '/' + path;
  const url = new URL(baseUrl + suffix);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function pageFromUrl(url: string | undefined): number | null {
  if (!url) return null;
  const match = /[?&]page=(\d+)/.exec(url);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseLinkHeader(header: string | undefined): GithubLink {
  if (!header) return { nextPage: null, lastPage: null };
  let nextPage: number | null = null;
  let lastPage: number | null = null;
  for (const part of header.split(',')) {
    const open = part.indexOf('<');
    const close = part.indexOf('>');
    if (open < 0 || close <= open) continue;
    const url = part.slice(open + 1, close);
    if (part.includes('rel="next"')) nextPage = pageFromUrl(url);
    else if (part.includes('rel="last"')) lastPage = pageFromUrl(url);
  }
  return { nextPage, lastPage };
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

function rateLimitDelayMs(headers: Record<string, string>): number | null {
  if (headers['x-ratelimit-remaining'] !== '0') return null;
  const reset = Number(headers['x-ratelimit-reset']);
  if (!Number.isFinite(reset) || reset <= 0) return null;
  const wait = reset * 1000 - Date.now();
  if (wait <= 0) return 1000;
  return Math.min(wait, MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function githubRequest<T>(
  options: GithubRequestOptions
): Promise<GithubResult<T>> {
  const cfg = getGithubConfig();
  if (!cfg.baseUrl) {
    throw new GithubApiError('GitHub 未配置实例地址，请设置 GITHUB_BASE_URL 或通过 configureGithubToolkit 注入配置', 0, false);
  }
  if (!cfg.token) {
    throw new GithubApiError('GitHub 未配置访问令牌，请设置 GITHUB_TOKEN 或通过 configureGithubToolkit 注入配置', 0, false);
  }

  const url = buildUrl(cfg.baseUrl, options.path, options.query);
  const idempotent = options.idempotent ?? options.method === 'GET';
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          Authorization: 'Bearer ' + cfg.token,
          Accept: options.raw ? 'text/plain' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'QNote',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const headers = headersToObject(response.headers);

      if (!response.ok) {
        const bodyText = await response.text();
        const limited = isRateLimited(response.status, bodyText, headers);
        const serverSide = limited || response.status === 429 || response.status >= 500;
        if (idempotent && serverSide && attempt < MAX_ATTEMPTS) {
          const wait = limited ? rateLimitDelayMs(headers) ?? backoffMs(attempt) : backoffMs(attempt);
          await sleep(wait);
          continue;
        }
        throw new GithubApiError(
          describeStatus(response.status, bodyText, headers),
          response.status,
          serverSide,
          bodyText.slice(0, 500)
        );
      }

      if (options.raw) {
        return { data: (await response.text()) as unknown as T, headers };
      }

      const text = await response.text();
      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : (null as T);
      } catch {
        throw new GithubApiError('GitHub 返回的内容不是合法 JSON', response.status, false, text.slice(0, 200));
      }
      return { data, headers };
    } catch (err) {
      if (err instanceof GithubApiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof Error && err.name === 'AbortError';
      if (idempotent && !timedOut && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (timedOut) {
        throw new GithubApiError(
          `请求 GitHub 超时（${Math.round(cfg.requestTimeoutMs / 1000)} 秒）`,
          0,
          true
        );
      }
      throw new GithubApiError('请求 GitHub 失败：' + message, 0, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function githubList<T>(
  path: string,
  query: Record<string, GithubQueryValue>,
  page: number,
  perPage: number
): Promise<GithubPage<T>> {
  const result = await githubRequest<T[]>({
    method: 'GET',
    path,
    query: { ...query, page, per_page: perPage },
    idempotent: true,
  });
  const link = parseLinkHeader(result.headers['link']);
  return {
    items: Array.isArray(result.data) ? result.data : [],
    nextPage: link.nextPage,
    total: null,
  };
}

export interface GithubProbe {
  ok: boolean;
  user: string | null;
  rateRemaining: number | null;
  error?: string;
}

export async function probeGithub(): Promise<GithubProbe> {
  try {
    const userResult = await githubRequest<{ login?: string; name?: string }>({
      method: 'GET',
      path: githubEndpoints.user(),
      idempotent: true,
    });
    let rateRemaining: number | null = null;
    try {
      const limitResult = await githubRequest<{ resources?: { core?: { remaining?: number } } }>({
        method: 'GET',
        path: githubEndpoints.rateLimit(),
        idempotent: true,
      });
      rateRemaining = limitResult.data?.resources?.core?.remaining ?? null;
    } catch {
      rateRemaining = null;
    }
    return {
      ok: true,
      user: userResult.data?.login ?? userResult.data?.name ?? null,
      rateRemaining,
    };
  } catch (err) {
    return {
      ok: false,
      user: null,
      rateRemaining: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let readyPromise: Promise<void> | null = null;

export async function ensureGithubReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = probeGithub()
      .then((probe) => {
        if (!probe.ok) {
          throw new GithubApiError('GitHub 连接自检失败：' + (probe.error ?? '未知原因'), 0, false);
        }
        getGithubLogger().info('[ai-github] 实例就绪 user=' + (probe.user ?? '未知') + ' rate_remaining=' + (probe.rateRemaining ?? '未知'));
      })
      .catch((err) => {
        readyPromise = null;
        throw err;
      });
  }
  return readyPromise;
}
