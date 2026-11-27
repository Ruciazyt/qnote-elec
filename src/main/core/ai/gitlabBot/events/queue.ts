import { log } from "../../../system/log";
import { getGitlabBotConfig } from "../config/configStore";
import { decideTrigger, summarizeText, type GitlabEvent } from "./webhook";

export interface QueueOptions {
  capacity?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  doneLimit?: number;
}

export interface EnqueueResult {
  accepted: boolean;
  reason: string;
  key: string;
}

const DEFAULT_CAPACITY = 50;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 2000;
const DEFAULT_DONE_LIMIT = 500;

function positiveInt(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : undefined;
}

export function dedupeKey(event: GitlabEvent): string {
  const project = positiveInt(event.projectId) ?? event.projectPath;
  if (event.objectKind === "note") {
    const noteId = positiveInt(event.noteId);
    if (noteId) return `note:${project}:${noteId}`;
  }
  if (event.objectKind === "issue") {
    const iid = positiveInt(event.issueIid);
    if (iid) return `issue:${project}:${iid}:${event.action ?? ""}`;
  }
  if (event.objectKind === "merge_request") {
    const iid = positiveInt(event.mrIid);
    if (iid) return `mr:${project}:${iid}:${event.action ?? ""}`;
  }
  const objectId = positiveInt(event.objectId);
  if (objectId) {
    return `${event.objectKind}:${project}:${objectId}:${event.action ?? ""}`;
  }
  return `${event.eventType}:${project}:${event.objectKind}:${event.issueIid ?? ""}:${event.mrIid ?? ""}:${event.title ?? ""}`;
}

export class GitlabEventQueue {
  private pending: GitlabEvent[] = [];
  private pendingKeys = new Set<string>();
  private doneKeys = new Set<string>();
  private pumping = false;

  private readonly capacity: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly doneLimit: number;

  constructor(
    private readonly consume: (
      event: GitlabEvent,
      instruction: string
    ) => Promise<void>,
    options: QueueOptions = {}
  ) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.doneLimit = options.doneLimit ?? DEFAULT_DONE_LIMIT;
  }

  get size(): number {
    return this.pending.length;
  }

  enqueue(event: GitlabEvent): EnqueueResult {
    const key = dedupeKey(event);
    if (this.pendingKeys.has(key)) {
      return { accepted: false, reason: `事件重复，正在队列里（${key}）`, key };
    }
    if (this.doneKeys.has(key)) {
      return { accepted: false, reason: `事件重复，已经处理过（${key}）`, key };
    }
    if (this.pending.length >= this.capacity) {
      const dropped = this.pending.shift();
      if (dropped) {
        const droppedKey = dedupeKey(dropped);
        this.pendingKeys.delete(droppedKey);
        log.warn("[gitlab-bot] 队列已满，丢弃最旧事件", { key: droppedKey });
      }
    }
    this.pending.push(event);
    this.pendingKeys.add(key);
    void this.pump();
    return { accepted: true, reason: "已入队", key };
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length) {
        const event = this.pending.shift();
        if (!event) break;
        const key = dedupeKey(event);
        try {
          await this.dispatch(event);
        } finally {
          this.markDone(key);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async dispatch(event: GitlabEvent): Promise<void> {
    const decision = decideTrigger(event, getGitlabBotConfig());
    if (!decision.ok) {
      log.info("[gitlab-bot] 未触发", {
        reason: decision.reason,
        project: event.projectPath,
        event: event.eventType,
      });
      return;
    }
    log.info("[gitlab-bot] 命中触发词", {
      project: event.projectPath,
      event: event.eventType,
      reason: decision.reason,
      instruction: summarizeText(decision.instruction, 120),
    });
    const instruction = decision.instruction ?? "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this.consume(event, instruction);
        return;
      } catch (err) {
        if (attempt >= this.maxRetries) {
          log.error("[gitlab-bot] 任务执行失败，已放弃", {
            attempts: attempt + 1,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        const wait = this.retryDelayMs * (attempt + 1);
        log.warn("[gitlab-bot] 任务执行失败，准备重试", { attempt: attempt + 1, wait });
        await delay(wait);
      }
    }
  }

  private markDone(key: string): void {
    this.pendingKeys.delete(key);
    if (this.doneKeys.size >= this.doneLimit) {
      this.doneKeys.clear();
    }
    this.doneKeys.add(key);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
