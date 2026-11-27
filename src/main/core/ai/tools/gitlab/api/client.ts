import { getGitlabLogger } from '../runtime/runtime';
import { getGitlabConfig } from '../runtime/config';
import { describeStatus } from './errors';
import { gitlabEndpoints } from './endpoints';

export { describeStatus } from './errors';
export { encodeProjectId } from './endpoints';

const MAX_ATTEMPTS = 3;

export class GitlabApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(message: string, status: number, retryable: boolean, detail?: string) {
    super(message);
    this.name = 'GitlabApiError';
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

export type GitlabQueryValue = string | number | boolean | undefined;

export interface GitlabRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, GitlabQueryValue>;
  body?: unknown;
  raw?: boolean;
  idempotent?: boolean;
}

export interface GitlabResult<T> {
  data: T;
  headers: Record<string, string>;
}

export interface GitlabPage<T> {
  items: T[];
  nextPage: number | null;
  total: number | null;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, GitlabQueryValue>): string {
  const suffix = path.startsWith('/') ? path : '/' + path;
  const url = new URL(baseUrl + '/api/v4' + suffix);
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

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function gitlabRequest<T>(options: GitlabRequestOptions): Promise<GitlabResult<T>> {
  const cfg = getGitlabConfig();
  if (!cfg.baseUrl) {
    throw new GitlabApiError('GitLab 未配置实例地址，请设置 GITLAB_BASE_URL 或通过 configureGitlabToolkit 注入配置', 0, false);
  }
  if (!cfg.token) {
    throw new GitlabApiError('GitLab 未配置访问令牌，请设置 GITLAB_TOKEN 或通过 configureGitlabToolkit 注入配置', 0, false);
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
          'PRIVATE-TOKEN': cfg.token,
          Accept: options.raw ? 'text/plain' : 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const headers = headersToObject(response.headers);

      if (!response.ok) {
        const bodyText = await response.text();
        const serverSide = response.status === 429 || response.status >= 500;
        if (idempotent && serverSide && attempt < MAX_ATTEMPTS) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new GitlabApiError(
          describeStatus(response.status, bodyText),
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
        throw new GitlabApiError('GitLab 返回的内容不是合法 JSON', response.status, false, text.slice(0, 200));
      }
      return { data, headers };
    } catch (err) {
      if (err instanceof GitlabApiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (idempotent && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new GitlabApiError('请求 GitLab 失败：' + message, 0, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function gitlabGet<T>(path: string): Promise<T> {
  return (await gitlabRequest<T>({ method: 'GET', path })).data;
}

export async function gitlabList<T>(
  path: string,
  query: Record<string, GitlabQueryValue>,
  page: number,
  perPage: number
): Promise<GitlabPage<T>> {
  const result = await gitlabRequest<T[]>({
    method: 'GET',
    path,
    query: { ...query, page, per_page: perPage },
    idempotent: true,
  });
  const nextRaw = (result.headers['x-next-page'] ?? '').trim();
  const totalRaw = (result.headers['x-total'] ?? '').trim();
  return {
    items: Array.isArray(result.data) ? result.data : [],
    nextPage: nextRaw ? Number(nextRaw) : null,
    total: totalRaw ? Number(totalRaw) : null,
  };
}

export interface GitlabProbe {
  ok: boolean;
  version: string | null;
  user: string | null;
  error?: string;
}

export async function probeGitlab(): Promise<GitlabProbe> {
  const cfg = getGitlabConfig();
  try {
    const versionResult = await gitlabRequest<{ version?: string }>({
      method: 'GET',
      path: gitlabEndpoints.version(),
      idempotent: true,
    });
    const version = typeof versionResult.data?.version === 'string' ? versionResult.data.version : null;
    if (cfg.expectedVersion && version && !version.startsWith(cfg.expectedVersion)) {
      return {
        ok: false,
        version,
        user: null,
        error: '实例版本不符：期望 ' + cfg.expectedVersion + '，实际 ' + version + '。检查 GITLAB_BASE_URL 是否指向预期实例。',
      };
    }
    const userResult = await gitlabRequest<{ username?: string; name?: string }>({
      method: 'GET',
      path: gitlabEndpoints.user(),
      idempotent: true,
    });
    const user = userResult.data?.username ?? userResult.data?.name ?? null;
    return { ok: true, version, user };
  } catch (err) {
    return {
      ok: false,
      version: null,
      user: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let readyPromise: Promise<void> | null = null;

export async function ensureGitlabReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = probeGitlab()
      .then((probe) => {
        if (!probe.ok) {
          throw new GitlabApiError('GitLab 连接自检失败：' + (probe.error ?? '未知原因'), 0, false);
        }
        getGitlabLogger().info('[ai-gitlab] 实例就绪 version=' + (probe.version ?? '未知') + ' user=' + (probe.user ?? '未知'));
      })
      .catch((err) => {
        readyPromise = null;
        throw err;
      });
  }
  return readyPromise;
}