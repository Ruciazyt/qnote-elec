/**
 * AI 长期记忆 — 纯文本文件存储
 *
 * ## 为什么是文件而不是表
 *
 * 1. **约束冲突**：memory_store.note_id 是外键指向剪贴板 note 表且唯一。
 *    AI 记忆没有对应的剪贴板记录，塞不进去 —— 硬塞就得往剪贴板插占位行，
 *    污染那条自动入库的数据流。
 * 2. **数据量根本用不着索引**：记忆是「几十到几百条偏好/事实」量级，
 *    每轮对话全文读入内存做筛选即可（几千字），比 SQL 查询还快。
 * 3. **可读可改**：JSON 明文，你用记事本就能看、能改、能删。这和笔记系统
 *    「纯文件制」的设计取向一致。
 *
 * ## 文件位置
 *
 * <userData>/ai-memory.json —— 放在 userData 而**不是笔记目录**。
 * 记忆是应用内部数据，不该混进用户的笔记里：那会让笔记列表凭空多出
 * 一个条目，用户还得想办法删掉它；笔记目录也可能被整体同步/备份带走。
 *
 * ## 为什么不复用 vectorStore 的打分算法
 *
 * 那套打分是为剪贴板历史设计的：关键词精确匹配 + 二元字组 + 30 天时新度衰减。
 * AI 记忆不该被这套规则绑住 —— 「用户偏好用中文回复」这种记忆，
 * 和当下这句话没有任何字面重叠，打分必然趋近于 0。
 * 所以这里用的是**语义类别匹配**（见 recall 的实现），刻意不复用。
 */
import * as fs from "fs";
import * as path from "node:path";
import { app } from "electron";
import { log } from "../../log";

/** 记忆的语义类别 —— AI 写入时必须选定其一 */
export type MemoryKind =
  | "preference"   // 偏好：语言、风格、工具习惯
  | "fact"         // 事实：稳定信息（工作单位、技术栈、常看的项目）
  | "convention"   // 约定：协作规则（提交信息用中文、别自动 commit）
  | "goal";        // 目标：长期在做的事

/** 单条记忆 */
export interface MemoryItem {
  /** 稳定 id，写入时生成；用于更新和删除 */
  id: string;
  /** 类别 */
  kind: MemoryKind;
  /** 记忆正文（一句话，尽量具体） */
  content: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 最近一次被更新或命中时刷新 —— 用于时新度排序 */
  updatedAt: number;
  /** 命中次数 */
  hitCount: number;
  /** 来源会话，便于日后追溯 */
  sourceSession?: string;
}

/** 文件内容的结构 */
interface MemoryFile {
  version: 1;
  items: MemoryItem[];
}

/** 文件名 */
const FILE_NAME = "ai-memory.json";

/** 单次读写后的大小上限 —— 防止异常情况下文件无限膨胀 */
const MAX_ITEMS = 500;

/** 正文长度上限 —— 一条记忆就是一句话，超长说明 AI 没想清楚该记什么 */
const MAX_CONTENT_LEN = 300;

/**
 * 计算去重用的归一化键
 *
 * 只去掉空白和标点，不做分词：跨语言通用，且"用中文回复"和"用中文  回复"
 * 应当判为同一条，而"Node.js 18"和"Nodejs18"不应当。
 */
function dedupeKey(content: string): string {
  return content
    .toLowerCase()
    .replace(/[\s，。、；：！？,.!?;:"'"'()（）【】\[\]]+/g, "");
}

/** 生成 id */
function makeId(): string {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 长期记忆存储（单例）
 *
 * 内存里始终持有完整列表：数据量小，且避免每轮对话读一次磁盘。
 * 任何写操作都会立即落盘并更新内存，不会出现内存/磁盘不一致。
 */
class LongTermMemory {
  private items: MemoryItem[] | null = null;
  private filePath: string | null = null;

  /** 记忆文件绝对路径（延迟到首次使用时才取 app.getPath） */
  private getFilePath(): string {
    if (!this.filePath) {
      this.filePath = path.join(app.getPath("userData"), FILE_NAME);
    }
    return this.filePath;
  }

  /** 从磁盘加载（带内存缓存） */
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
      // 宽松解析：结构不符就当空列表，而不是让整个 AI 链路挂掉
      if (!parsed || !Array.isArray(parsed.items)) {
        log.warn("[memory] 记忆文件结构异常，按空处理:", p);
        this.items = [];
        return this.items;
      }
      this.items = parsed.items.filter((x) => x && typeof x.content === "string" && x.content.trim());
      log.info(`[memory] 已加载 ${this.items.length} 条长期记忆`);
    } catch (err) {
      // 文件损坏时不要静默清空 —— 保留现场，用户还能手工抢救
      log.error("[memory] 读取记忆文件失败，本次按空处理", err);
      this.items = [];
    }
    return this.items;
  }

  /** 落盘 */
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

  /**
   * 写入 / 更新一条记忆
   *
   * 去重策略：归一化后完全相同视为同一条 —— 更新内容并刷新时间，
   * 而不是新增。否则 AI 反复记同一件事会把列表撑爆。
   *
   * @returns 该条记忆，以及是否为新增
   */
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
      // 同一条记忆：只刷新时新度和来源，不新增行。
      // 刻意不改 content —— 相似的表述归一到先写的那条，避免
      // 「用户偏好中文」被反复改写成各种近似说法。
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

    // 超量时丢弃最旧的（末尾 = 最久没更新）
    if (items.length > MAX_ITEMS) {
      const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
      this.items = sorted.slice(0, MAX_ITEMS);
    }

    this.save();
    return { item, created: true };
  }

  /** 列出全部记忆（新的在前） */
  list(kind?: MemoryKind): MemoryItem[] {
    const items = [...this.load()].sort((a, b) => b.updatedAt - a.updatedAt);
    return kind ? items.filter((x) => x.kind === kind) : items;
  }

  /**
   * 召回与当前问题相关的记忆
   *
   * 刻意不走关键词打分（理由见文件头）。这里用的是：
   *   - 类别启发式：问题里出现「喜欢/偏好/习惯」这类词，优先返回 preference
   *   - 字面重合：用户消息与记忆正文有直接的字符/词重叠时才命中
   *   - 时新度：同等条件下最近更新的排前面
   *
   * 召回宁缺毋滥 —— 塞一堆不相关的记忆进 prompt 只会稀释模型的注意力，
   * 并增加 token 成本。
   */
  recall(query: string, limit = 8): MemoryItem[] {
    const items = this.list();
    if (items.length === 0) return [];

    const q = (query ?? "").toLowerCase();
    const qKey = dedupeKey(query ?? "");

    // 类别启发式关键词 —— 中文为主，够用即可
    const prefHints = ["喜欢", "偏好", "习惯", "风格", "prefer", "喜欢用"];
    const goalHints = ["目标", "计划", "打算", "要做", "goal"];
    const conventionHints = ["约定", "规范", "规则", "提交", "commit", "不要"];

    const hinted = (hints: string[]) => hints.some((h) => q.includes(h.toLowerCase()));

    const scored = items.map((item) => {
      let score = 0;
      const key = dedupeKey(item.content);

      // 字面重合：记忆正文整段出现在问题里，或问题整段落在记忆里
      if (key.length > 2 && (qKey.includes(key) || key.includes(qKey))) {
        score += 0.5;
      }
      // 类别命中
      if (hinted(prefHints) && item.kind === "preference") score += 0.25;
      if (hinted(goalHints) && item.kind === "goal") score += 0.25;
      if (hinted(conventionHints) && item.kind === "convention") score += 0.25;

      // 时新度：30 天线性衰减，最高 0.2
      const ageDays = Math.max(0, (Date.now() - item.updatedAt) / 86400000);
      score += Math.max(0, 0.2 - ageDays / 150);

      return { item, score };
    });

    return scored
      .filter((x) => x.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => {
        // 命中计数只更新不落盘：这类写太频繁（每轮可能都写），
        // 同步写盘会把 IO 拖慢；进程内计数足够用于统计。
        x.item.hitCount += 1;
        return x.item;
      });
  }

  /** 按 id 删除 */
  forget(id: string): boolean {
    const items = this.load();
    const before = items.length;
    this.items = items.filter((x) => x.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  /** 清空全部记忆 */
  clear(): number {
    const n = this.load().length;
    this.items = [];
    this.save();
    return n;
  }

  /** 统计（调试 / 设置页展示用） */
  stats(): { total: number; byKind: Record<string, number> } {
    const items = this.load();
    const byKind: Record<string, number> = {};
    for (const x of items) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
    return { total: items.length, byKind };
  }

  /** 让内存缓存失效（测试用 / 外部改过文件后） */
  invalidate(): void {
    this.items = null;
  }
}

/** 全局单例 */
export const longTermMemory = new LongTermMemory();