import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { log } from "../../system/log";

export type MemoryKind =
  | "preference"
  | "fact"
  | "convention"
  | "goal";

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  content: string;
  createdAt: number;
  updatedAt: number;
  hitCount: number;
  sourceSession?: string;
}

interface MemoryFile {
  version: 1;
  items: MemoryItem[];
}

const FILE_NAME = "ai-memory.json";

const MAX_ITEMS = 500;

const MAX_CONTENT_LEN = 300;

function dedupeKey(content: string): string {
  return content
    .toLowerCase()
    .replace(/[\s，。、；：！？,.!?;:"'"'()（）【】[\]]+/g, "");
}

function makeId(): string {
  return `mem-${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`;
}

class LongTermMemory {
  private items: MemoryItem[] | null = null;
  private filePath: string | null = null;

  private getFilePath(): string {
    if (!this.filePath) {
      this.filePath = path.join(app.getPath("userData"), FILE_NAME);
    }
    return this.filePath;
  }

  private load(): MemoryItem[] {
    if (this.items) return this.items;

    const p = this.getFilePath();
    try {
      if (!fs.existsSync(p)) {
        this.items = [];
        return this.items;
      }
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw) as MemoryFile;
      if (!parsed || !Array.isArray(parsed.items)) {
        log.warn("[memory] 记忆文件结构异常，按空处理:", p);
        this.items = [];
        return this.items;
      }
      this.items = parsed.items.filter((x) => x && typeof x.content === "string" && x.content.trim());
      log.info(`[memory] 已加载 ${this.items.length} 条长期记忆`);
    } catch (err) {
      log.error("[memory] 读取记忆文件失败，本次按空处理", err);
      this.items = [];
    }
    return this.items;
  }

  private save(): void {
    const items = this.load();
    const payload: MemoryFile = { version: 1, items };
    const p = this.getFilePath();
    try {
      fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf-8");
    } catch (err) {
      log.error("[memory] 写入记忆文件失败", err);
      throw new Error(`写入记忆失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  remember(input: {
    kind: MemoryKind;
    content: string;
    sourceSession?: string;
  }): { item: MemoryItem; created: boolean } {
    const items = this.load();
    const content = (input.content ?? "").trim().slice(0, MAX_CONTENT_LEN);
    if (!content) {
      throw new Error("记忆内容为空");
    }

    const key = dedupeKey(content);
    const now = Date.now();
    const existing = items.find((x) => dedupeKey(x.content) === key);

    if (existing) {
      existing.updatedAt = now;
      existing.hitCount += 1;
      if (input.sourceSession) existing.sourceSession = input.sourceSession;
      this.save();
      return { item: existing, created: false };
    }

    const item: MemoryItem = {
      id: makeId(),
      kind: input.kind,
      content,
      createdAt: now,
      updatedAt: now,
      hitCount: 0,
      sourceSession: input.sourceSession,
    };

    items.unshift(item);

    if (items.length > MAX_ITEMS) {
      const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
      this.items = sorted.slice(0, MAX_ITEMS);
    }

    this.save();
    return { item, created: true };
  }

  list(kind?: MemoryKind): MemoryItem[] {
    const items = [...this.load()].sort((a, b) => b.updatedAt - a.updatedAt);
    return kind ? items.filter((x) => x.kind === kind) : items;
  }

  recall(query: string, limit = 8): MemoryItem[] {
    const items = this.list();
    if (items.length === 0) return [];

    const q = (query ?? "").toLowerCase();
    const qKey = dedupeKey(query ?? "");

    const prefHints = ["喜欢", "偏好", "习惯", "风格", "prefer", "喜欢用"];
    const goalHints = ["目标", "计划", "打算", "要做", "goal"];
    const conventionHints = ["约定", "规范", "规则", "提交", "commit", "不要"];

    const hinted = (hints: string[]) => hints.some((h) => q.includes(h.toLowerCase()));

    const scored = items.map((item) => {
      let score = 0;
      const key = dedupeKey(item.content);

      if (key.length > 2 && (qKey.includes(key) || key.includes(qKey))) {
        score += 0.5;
      }
      if (hinted(prefHints) && item.kind === "preference") score += 0.25;
      if (hinted(goalHints) && item.kind === "goal") score += 0.25;
      if (hinted(conventionHints) && item.kind === "convention") score += 0.25;

      const ageDays = Math.max(0, (Date.now() - item.updatedAt) / 86400000);
      score += Math.max(0, 0.2 - ageDays / 150);

      return { item, score };
    });

    return scored
      .filter((x) => x.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => {
        x.item.hitCount += 1;
        return x.item;
      });
  }

  forget(id: string): boolean {
    const items = this.load();
    const before = items.length;
    this.items = items.filter((x) => x.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  clear(): number {
    const n = this.load().length;
    this.items = [];
    this.save();
    return n;
  }

  stats(): { total: number; byKind: Record<string, number> } {
    const items = this.load();
    const byKind: Record<string, number> = {};
    for (const x of items) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
    return { total: items.length, byKind };
  }

  invalidate(): void {
    this.items = null;
  }
}

export const longTermMemory = new LongTermMemory();