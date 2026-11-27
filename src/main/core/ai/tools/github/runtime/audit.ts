import { getGithubLogger } from './runtime';

export interface GithubAuditEntry {
  tool: string;
  repository?: string;
  url?: string;
  durationMs: number;
  ok: boolean;
  dryRun?: boolean;
  error?: string;
}

export function audit(entry: GithubAuditEntry): void {
  const parts = [
    '[ai-github] tool=' + entry.tool,
    entry.repository ? 'repository=' + entry.repository : '',
    entry.url ? 'url=' + entry.url : '',
    entry.durationMs + 'ms',
    entry.dryRun ? 'dry-run' : '',
    entry.ok ? 'ok' : 'fail',
  ].filter(Boolean);
  const logger = getGithubLogger();
  if (entry.ok) {
    logger.info(parts.join(' '));
  } else {
    logger.warn(parts.join(' ') + (entry.error ? ' error=' + entry.error : ''));
  }
}
