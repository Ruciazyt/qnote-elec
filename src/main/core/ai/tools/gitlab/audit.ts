import { log } from '../../../system/log';

export interface AuditEntry {
  tool: string;
  project?: string;
  url?: string;
  durationMs: number;
  ok: boolean;
  dryRun?: boolean;
  error?: string;
}

export function audit(entry: AuditEntry): void {
  const parts = [
    '[ai-gitlab] tool=' + entry.tool,
    entry.project ? 'project=' + entry.project : '',
    entry.url ? 'url=' + entry.url : '',
    entry.durationMs + 'ms',
    entry.dryRun ? 'dry-run' : '',
    entry.ok ? 'ok' : 'fail',
  ].filter(Boolean);
  if (entry.ok) {
    log.info(parts.join(' '));
  } else {
    log.warn(parts.join(' ') + (entry.error ? ' error=' + entry.error : ''));
  }
}