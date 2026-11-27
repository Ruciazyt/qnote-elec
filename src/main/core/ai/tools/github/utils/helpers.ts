import { GithubApiError, ensureGithubReady, githubList } from '../api/client';
import type { GithubQueryValue } from '../api/client';
import { getGithubConfig } from '../runtime/config';
import { checkRepositoryAllowed, checkRepositoryFormat, checkWriteAllowed } from './guards';
import { truncateByTokens } from '../../shared/tokens';
import { ListCursorError, listWithCursor as listWithCursorShared } from '../../shared/list';
import type { CursorListParams, CursorListResult, ListFetcher } from '../../shared/list';
import { audit } from '../runtime/audit';
import { writeGithubOverflow } from '../runtime/runtime';

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

export async function runGithubTool(
  name: string,
  repository: string | undefined,
  fn: () => Promise<Record<string, unknown>>
): Promise<string> {
  const started = Date.now();
  try {
    await ensureGithubReady();
    const payload = await fn();
    audit({ tool: name, repository, durationMs: Date.now() - started, ok: true });
    return JSON.stringify({ ok: true, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    audit({ tool: name, repository, durationMs: Date.now() - started, ok: false, error: message });
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
  const fullPath = await writeGithubOverflow(label, text);
  return {
    text: capped.text,
    truncated: true,
    fullPath,
    estimatedTokens: capped.estimatedTokens,
  };
}

export function requireRepository(repository: string | undefined): string {
  const cfg = getGithubConfig();
  const value = (repository ?? '').trim();
  if (!value) throw new GithubApiError('缺少仓库名（形如 owner/repo）', 0, false);
  const formatProblem = checkRepositoryFormat(value);
  if (formatProblem) throw new GithubApiError(formatProblem, 0, false);
  const allowedProblem = checkRepositoryAllowed(value, cfg.allowedRepositories);
  if (allowedProblem) throw new GithubApiError(allowedProblem, 0, false);
  return value;
}

export function requireWritable(): void {
  const cfg = getGithubConfig();
  const problem = checkWriteAllowed(cfg.readOnly);
  if (problem) throw new GithubApiError(problem, 0, false);
}

export async function listWithCursorUsing<T>(
  params: CursorListParams,
  list: ListFetcher<T>
): Promise<CursorListResult<T>> {
  try {
    return await listWithCursorShared(params, list);
  } catch (err) {
    if (err instanceof ListCursorError) throw new GithubApiError(err.message, 0, false);
    throw err;
  }
}

export async function listWithCursor<T>(
  params: CursorListParams
): Promise<CursorListResult<T>> {
  return listWithCursorUsing<T>(params, githubList);
}

export type { GithubQueryValue };
