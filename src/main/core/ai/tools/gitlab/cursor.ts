import { randomBytes } from 'node:crypto';

export interface CursorState {
  kind: string;
  path: string;
  query: Record<string, string>;
  page: number;
  perPage: number;
}

interface StoredCursor extends CursorState {
  createdAt: number;
  uses: number;
}

const TTL_MS = 30 * 60 * 1000;
const MAX_USES = 5;
const MAX_ENTRIES = 200;

const cursors = new Map<string, StoredCursor>();

export function issueCursor(state: CursorState): string {
  const key = 'gc_' + randomBytes(12).toString('hex');
  cursors.set(key, { ...state, createdAt: Date.now(), uses: 0 });
  if (cursors.size > MAX_ENTRIES) {
    const oldest = [...cursors.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) cursors.delete(oldest[0]);
  }
  return key;
}

export function readCursor(cursor: string): CursorState | null {
  const stored = cursors.get(cursor);
  if (!stored) return null;
  if (Date.now() - stored.createdAt > TTL_MS || stored.uses >= MAX_USES) {
    cursors.delete(cursor);
    return null;
  }
  stored.uses += 1;
  return {
    kind: stored.kind,
    path: stored.path,
    query: stored.query,
    page: stored.page,
    perPage: stored.perPage,
  };
}

export function clearCursors(): void {
  cursors.clear();
}