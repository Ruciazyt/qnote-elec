
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: string;
  isError?: boolean;
  status?: 'calling' | 'done';
}

export type AssistantBlock =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; call: ToolCallRecord }
  | { kind: 'text'; text: string };

function trailingPartialTagLength(value: string, tag: string): number {
  const v = value.toLowerCase();
  const t = tag.toLowerCase();
  for (let len = Math.min(v.length, t.length - 1); len > 0; len -= 1) {
    if (v.endsWith(t.slice(0, len))) return len;
  }
  return 0;
}

export class BlockBuilder {
  private list: AssistantBlock[] = [];
  private currentKind: 'thinking' | 'text' | null = null;
  private inThink = false;
  private pending = '';

  pushText(delta: string): void {
    if (!delta) return;
    let rest = this.pending + delta;
    this.pending = '';

    while (rest.length > 0) {
      const open = this.inThink ? THINK_CLOSE : THINK_OPEN;
      const at = rest.toLowerCase().indexOf(open);

      if (at === -1) {
        const keep = rest.length - trailingPartialTagLength(rest, open);
        if (keep > 0) this.append(this.inThink ? 'thinking' : 'text', rest.slice(0, keep));
        this.pending = keep > 0 ? rest.slice(keep) : rest;
        return;
      }

      this.append(this.inThink ? 'thinking' : 'text', rest.slice(0, at));
      this.flush();
      this.inThink = !this.inThink;
      rest = rest.slice(at + open.length);
    }
  }

  pushToolCall(call: ToolCallRecord): void {
    this.flush();
    this.list.push({ kind: 'tool', call: { ...call, status: 'calling' } });
    this.currentKind = null;
  }

  pushToolResult(id: string, result: string, isError: boolean): void {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const b = this.list[i];
      if (b.kind === 'tool' && b.call.id === id) {
        b.call.result = result;
        b.call.isError = isError;
        b.call.status = 'done';
        return;
      }
    }
    this.list.push({
      kind: 'tool',
      call: { id, name: '未知工具', args: {}, result, isError, status: 'done' },
    });
  }

  private append(kind: 'thinking' | 'text', text: string): void {
    if (!text) return;
    const last = this.list[this.list.length - 1];
    if (this.currentKind === kind && last && last.kind === kind) {
      last.text += text;
    } else {
      this.list.push({ kind, text });
      this.currentKind = kind;
    }
  }

  private flush(): void {
    this.currentKind = null;
  }

  blocks(): AssistantBlock[] {
    if (this.pending) {
      this.append(this.inThink ? 'thinking' : 'text', this.pending);
      this.pending = '';
    }
    return this.list
      .filter((b) => (b.kind === 'tool' ? true : b.text.trim().length > 0))
      .map((b) =>
        b.kind === 'tool'
          ? { ...b, call: { ...b.call, status: b.call.status ?? 'done' } }
          : b
      );
  }
}

export function parseBlocks(raw: unknown): AssistantBlock[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b: any) =>
        (b?.kind === 'thinking' || b?.kind === 'text') && typeof b.text === 'string'
        ? true
        : b?.kind === 'tool' && b?.call?.name
    );
  } catch {
    return [];
  }
}

export function serializeBlocks(
  blocks: AssistantBlock[],
  maxResultLen = 2048
): string {
  if (!blocks || blocks.length === 0) return "";
  return JSON.stringify(
    blocks.map((b) =>
      b.kind === 'tool'
        ? {
            ...b,
            call: {
              ...b.call,
              result:
                typeof b.call.result === 'string' && b.call.result.length > maxResultLen
                  ? b.call.result.slice(0, maxResultLen) + '…（结果过长已截断）'
                  : b.call.result,
            },
          }
        : b
    )
  );
}