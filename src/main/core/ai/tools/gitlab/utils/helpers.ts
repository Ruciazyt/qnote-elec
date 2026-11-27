import { GitlabApiError, ensureGitlabReady, gitlabList } from '../api/client';
import { getGitlabConfig } from '../runtime/config';
import { checkProjectAllowed, checkWriteAllowed } from './guards';
import { ListCursorError, listWithCursor as listWithCursorShared } from '../../shared/list';
import type { CursorListParams, CursorListResult } from '../../shared/list';
import { truncateByTokens } from './shape';
import { audit } from '../runtime/audit';
import { writeGitlabOverflow } from '../runtime/runtime';

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

export function toGitlabStateEvent(state: 'opened' | 'closed'): 'reopen' | 'close' {
  return state === 'closed' ? 'close' : 'reopen';
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
  const fullPath = await writeGitlabOverflow(label, text);
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

export async function listWithCursor<T>(
  params: CursorListParams
): Promise<CursorListResult<T>> {
  try {
    return await listWithCursorShared<T>(params, (path, query, page, perPage) =>
      gitlabList<T>(path, query, page, perPage)
    );
  } catch (err) {
    if (err instanceof ListCursorError) throw new GitlabApiError(err.message, 0, false);
    throw err;
  }
}