/**
 * AI 回复的有序分块 —— 思考 / 工具调用 / 输出，按发生顺序排
 *
 * ## 为什么不能靠「一个 content 字符串 + 一个工具数组」拼
 *
 * 那样只能把工具统一塞到正文前面或后面，丢掉真实的先后关系：
 * 思考 → 调工具 → 思考 → 调工具 → 输出，这个顺序只有事件流知道。
 * 而交错顺序在重启后无法从两个数组重建，所以必须**整条存下来**。
 *
 * ## 为什么是增量的
 *
 * 事件是流式一条条到的（chunk / tool_call / tool_result 三个通道），
 * 而 `<think>` 标签还可能被切在两个 chunk 中间。用「攒齐了再整体切分」
 * 的做法处理不了这个 —— 必须边收边切，所以这里是个有状态的构建器。
 *
 * 主进程用它落库（重启后还在），渲染层用它实时渲染，两边同一份实现。
 */

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** 一条工具调用 */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: string;
  isError?: boolean;
  /** 仅流式期间有：用于显示「调用中」的转圈态 */
  status?: 'calling' | 'done';
}

/** AI 回复里的一个有序块 */
export type AssistantBlock =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; call: ToolCallRecord }
  | { kind: 'text'; text: string };

/**
 * 标签被切在 chunk 中间时，这段残缺的前缀有多长。
 *
 * 收到的可能是 "<thi" 这种还没成型的开头，不能当正文写出去 ——
 * 否则前端切 `<think>` 时会漏掉半个标签，整段推理块就识别不出来。
 */
function trailingPartialTagLength(value: string, tag: string): number {
  const v = value.toLowerCase();
  const t = tag.toLowerCase();
  for (let len = Math.min(v.length, t.length - 1); len > 0; len -= 1) {
    if (v.endsWith(t.slice(0, len))) return len;
  }
  return 0;
}

/**
 * 增量构建有序块
 *
 * 用法：主进程和渲染层各自 new 一个，喂同样的事件流，最后 `blocks()` 取结果。
 */
export class BlockBuilder {
  private list: AssistantBlock[] = [];
  /** 当前正在写的块（相邻同类会合并，避免每来一个 chunk 就多一个块） */
  private currentKind: 'thinking' | 'text' | null = null;
  private inThink = false;
  /**
   * 上一块结尾没凑齐的半个标签（如 "<thi"），等下一块来时拼上。
   *
   * 必须留着而不是丢掉：SSE 的 chunk 边界和标签边界没有任何关系，
   * 丢掉的话模型一个正常的 <think> 会被切成「正文 + 半个标签」，
   * 整段推理就再也识别不出来了。
   */
  private pending = '';

  /** 收到文本增量 */
  pushText(delta: string): void {
    if (!delta) return;
    let rest = this.pending + delta;
    this.pending = '';

    while (rest.length > 0) {
      const open = this.inThink ? THINK_CLOSE : THINK_OPEN;
      const at = rest.toLowerCase().indexOf(open);

      if (at === -1) {
        // 没有完整标签：正文部分先落下去，残缺的前缀留到下一块
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

  /** 模型决定调工具 —— 先把正在写的文本块收尾，再插工具块 */
  pushToolCall(call: ToolCallRecord): void {
    this.flush();
    this.list.push({ kind: 'tool', call: { ...call, status: 'calling' } });
    this.currentKind = null;
  }

  /** 工具执行完 —— 就地补到对应的工具块上 */
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
    // 找不到对应调用（理论上不该发生）：补一个孤儿结果，避免 UI 上凭空少一条
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

  /** 收尾当前块（下一个块类型可能不同） */
  private flush(): void {
    this.currentKind = null;
  }

  /** 丢掉空块后返回最终序列 */
  blocks(): AssistantBlock[] {
    // 流结束时可能还留着半个标签（模型就是这么停的），当正文落下去，
    // 丢掉会让用户看到的内容凭空少几个字符
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

/** 从落库的 JSON 还原；结构不对就当没有，别让整个历史读取失败 */
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

/** 落库前的序列化（结果太长会截断，避免单条记录膨胀） */
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