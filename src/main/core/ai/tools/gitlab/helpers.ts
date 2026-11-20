import { GitlabApiError, ensureGitlabReady, gitlabList, type GitlabQueryValue } from './client';
import { getGitlabConfig } from './config';
import { issueCursor, readCursor } from './cursor';
import { checkProjectAllowed, checkWriteAllowed } from './guards';
import { truncateByTokens } from './shape';
import { audit } from './audit';

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

export async function runGitlabTool(
  name: string,
  project: string | undefined,
  fn: () => Promise<Record<string, unknown>>
): Promise<string> {
  const started = Date.now();
  try {
    await ensureGitlabReady();
    const payload = await fn();
    audit({ tool: name, project, durationMs: Date.now() - started, ok: true });
    return JSON.stringify({ ok: true, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    audit({ tool: name, project, durationMs: Date.now() - started, ok: false, error: message });
    return JSON.stringify({ ok: false, error: message });
  }
}

export async function capText(
  text: string,
  label: string,
  maxTokens: number
): Promise<{
  text: string;
  truncated: boolean;
  fullPath: string | null;
  estimatedTokens: number;
}> {
  const capped = truncateByTokens(text, maxTokens);
  if (!capped.truncated) {
    return {
      text: capped.text,
      truncated: false,
      fullPath: null,
      estimatedTokens: capped.estimatedTokens,
    };
  }
  const { writeOverflow } = await import('./overflow');
  const fullPath = await writeOverflow(label, text);
  return {
    text: capped.text,
    truncated: true,
    fullPath,
    estimatedTokens: capped.estimatedTokens,
  };
}

export function requireProject(project: string | undefined): string {
  const cfg = getGitlabConfig();
  const value = (project ?? '').trim();
  if (!value) throw new GitlabApiError('缺少项目路径（形如 组名/项目名，或数字项目 ID）', 0, false);
  const problem = checkProjectAllowed(value, cfg.allowedProjects);
  if (problem) throw new GitlabApiError(problem, 0, false);
  return value;
}

export function requireWritable(): void {
  const cfg = getGitlabConfig();
  const problem = checkWriteAllowed(cfg.readOnly);
  if (problem) throw new GitlabApiError(problem, 0, false);
}

export interface CursorListParams {
  kind: string;
  path: string;
  query: Record<string, GitlabQueryValue>;
  cursor?: string;
  perPage: number;
}

export interface CursorListResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export async function listWithCursor<T>(
  params: CursorListParams
): Promise<CursorListResult<T>> {
  let path = params.path;
  let query = params.query;
  let page = 1;
  let perPage = params.perPage;

  if (params.cursor) {
    const state = readCursor(params.cursor);
    if (!state || state.kind !== params.kind) {
      throw new GitlabApiError('翻页句柄已失效，请重新执行一次列表调用', 0, false);
    }
    path = state.path;
    query = state.query;
    page = state.page;
    perPage = state.perPage;
  }

  const result = await gitlabList<T>(path, query, page, perPage);
  const nextCursor = result.nextPage
    ? issueCursor({
        kind: params.kind,
        path,
        query: Object.fromEntries(
          Object.entries(query)
            .filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== '')
            .map((entry) => [entry[0], String(entry[1])])
        ),
        page: result.nextPage,
        perPage,
      })
    : null;

  return { items: result.items, nextCursor, total: result.total };
}