import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { log } from './log';

interface VectorSearchResult {
  id: string;
  noteId: number;
  content: string;
  type: string;
  ocr_result?: string;
  distance: number;
}

interface AiConfig {
  provider: 'openai' | 'deepseek' | 'claude';
  apiKey: string;
  model: string;
}

/**
 * 召回的最低相关度阈值
 *
 * 为什么需要它：
 *   scoreMemory 的时间衰减项是 `recencyScore = (1 - 天数/30) * 0.05`。
 *   这意味着**任何**条目（哪怕跟查询毫无字面关系）在 30 天内都会拿到最多
 *   0.05 分。原来的 `.filter(similarity > 0)` 会把这些纯噪声放进结果，
 *   挤占 topK 槽位，还会被 buildMemoryDigest 统计进「高频主题词」，
 *   给模型一个误导性的记忆摘要。
 *
 * 为什么是 0.1：
 *   - 0.05 是纯时间分（零字面重合）的上限
 *   - 0.10 意味着至少要有一点词或字符级重合
 *   - 真实的弱相关查询（「Hooks 怎么用」召回「React Hooks ...」）实测 0.32，
 *     留了 3 倍余量，不会误伤
 */
const MEMORY_MIN_SIMILARITY = 0.1;

/**
 * 记忆评分缓存（id -> 派生数据）的条目上限，LRU 淘汰
 *
 * 为什么需要上限：主进程是长生命周期进程，memory_store 只增不减地
 * 挂在表上，无界 Map 会变成新的内存泄漏。
 *
 * 为什么是 2000：
 *   - memory_store 与 note 是一对一（note_id 唯一 + 级联删除），
 *     个人笔记量通常在几千条以内，2000 足以覆盖绝大多数场景
 *   - 更关键的是：searchSimilar 每次都是**整表扫描**。如果上限小于
 *     表大小，每一轮查询都会把缓存整批挤掉，命中率直接归零，
 *     优化等于白做。所以上限必须明显高于真实表规模，而不是取小值省内存
 *   - 单条缓存 = 归一化后的 memory_text 字符串（与行文本同量级）
 *     + 两个上限 32 的 token 集合。取 2000 条，即使每条都带几 KB 的
 *     OCR 全文，最坏情况也在十几 MB 以内
 *   - 淘汰只影响命中率（下次重新派生），不影响任何检索结果
 */
const MEMORY_SCORE_CACHE_LIMIT = 2000;

/**
 * 单条记忆「与行内容有关、与查询无关」的派生数据
 *
 * 改造前 scoreMemory 每次查询都会对每一行重跑一遍
 * normalizeText + 多次 tokenize（tokenize 内部是 extractKeywords，
 * 即一次 Unicode 正则匹配 + 一次字符 bigram 循环），整表扫描的开销
 * 与行数成正比；而 AI agent 每轮迭代都会再检索一次，N 轮就是 N 倍。
 *
 * 这些值只取决于行本身，所以算一次缓存起来，查询时直接复用。
 * 注意 recencyScore 依赖 Date.now()，**不能**缓存，仍然每次重算。
 */
interface MemoryScoreEntry {
  /** updated_at 指纹：变了说明这一行被改写过，缓存作废 */
  stamp: string;
  /** memory_text 归一化后的结果，exactMatch 依赖它 */
  normalizedMemory: string;
  /** keywords 列切出来的词集合 */
  memoryTokens: Set<string>;
  /** memory_text 去掉所有空白后按字符 bigram 得到的集合 */
  memoryCharTokens: Set<string>;
}

/**
 * 一次检索内所有行共享的查询侧预计算结果
 *
 * 改造前 queryTokens / queryChars 也在每行的循环里重新算了一遍，
 * 但它们只跟 query 有关，整轮检索算一次即可（tokenize 是纯函数，
 * 提前算不会改变任何结果）。
 */
interface QueryScoreInput {
  normalizedQuery: string;
  queryTokens: Set<string>;
  queryCharTokens: Set<string>;
}

class VectorStore {
  private DB: Knex | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private memoryMode = 'local-memory';
  /**
   * 记忆评分派生缓存：Map 的插入顺序即 LRU 顺序
   *
   * 以 id 为键、entry.stamp 做命中校验，等价于按 id + updated_at 联合键
   * 缓存：同一行被重新 upsert（updated_at 变化）之后，stamp 对不上，
   * 一定会重新派生，不可能命中过期 token。
   */
  private memoryScoreCache = new Map<string, MemoryScoreEntry>();

  init(DB: Knex) {
    this.DB = DB;
    // 换了数据库连接，旧连接下派生出来的缓存直接作废
    this.memoryScoreCache.clear();
  }

  setInitialConfig(chromaServerUrl: string, embeddingServiceUrl: string) {
    log.info('Vector store switched to local memory mode', {
      requestedChromaServerUrl: chromaServerUrl,
      requestedEmbeddingServiceUrl: embeddingServiceUrl,
      mode: this.memoryMode
    });
  }

  async initialize(): Promise<void> {
    // 显式比 null，不要用 if (this.initializationPromise) ——
    // Promise 对象恒为真，写成布尔条件容易被误读成「判断 promise 的状态」
    if (this.initializationPromise !== null) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.initializeInternal().finally(() => {
      this.initializationPromise = null;
    });

    return this.initializationPromise;
  }

  private async initializeInternal(): Promise<void> {
    try {
      this.isInitialized = false;
      if (!this.DB) {
        throw new Error('VectorStore database has not been initialized');
      }

      await this.ensureMemoryTable();

      this.isInitialized = true;
      log.info('Local memory store initialized successfully');
    } catch (error) {
      this.isInitialized = false;
      log.error('Failed to initialize local memory store:', error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized && this.DB) {
      return;
    }

    await this.initialize();

    if (!this.isInitialized || !this.DB) {
      throw new Error('Memory store not initialized. Please check local database availability.');
    }
  }

  isReady(): boolean {
    return this.isInitialized && this.DB !== null;
  }

  async updateConfig(chromaServerUrl: string, embeddingServiceUrl: string): Promise<{ success: boolean; error?: string }> {
    log.info('Ignoring remote vector config update in local memory mode', { chromaServerUrl, embeddingServiceUrl });
    return { success: true };
  }

  getConfig(): { chromaServerUrl: string; embeddingServiceUrl: string } {
    return {
      chromaServerUrl: this.memoryMode,
      embeddingServiceUrl: this.memoryMode
    };
  }

  private async ensureMemoryTable(): Promise<void> {
    const DB = this.getDB();
    const hasTable = await DB.schema.hasTable('memory_store');

    if (!hasTable) {
      await DB.schema.createTable('memory_store', (table) => {
        table.string('id').primary();
        table.integer('note_id').notNullable().unique();
        table.text('content').notNullable();
        table.text('memory_text').notNullable();
        table.text('summary').notNullable().defaultTo('');
        table.text('keywords').notNullable().defaultTo('');
        table.string('type').notNullable().defaultTo('text');
        table.text('ocr_result').defaultTo('');
        table.timestamp('created_at').defaultTo(DB.fn.now());
        table.timestamp('updated_at').defaultTo(DB.fn.now());
        table.foreign('note_id').references('id').inTable('note').onDelete('CASCADE');
      });
    }

    const hasNoteIdIndex = await DB.raw("PRAGMA index_list('memory_store')");
    const hasMemoryTextColumn = await DB.raw("PRAGMA table_info(memory_store)");
    const hasMemoryText = hasMemoryTextColumn.some((col: { name: string }) => col.name === 'memory_text');

    if (!hasMemoryText) {
      await DB.raw("ALTER TABLE memory_store ADD COLUMN memory_text TEXT DEFAULT ''");
    }

    if (!Array.isArray(hasNoteIdIndex) || !hasNoteIdIndex.some((idx: { name: string }) => idx.name === 'memory_store_note_id_idx')) {
      await DB.raw('CREATE INDEX IF NOT EXISTS memory_store_note_id_idx ON memory_store(note_id)');
    }
  }

  private getDB(): Knex {
    if (!this.DB) {
      throw new Error('VectorStore database has not been initialized');
    }
    return this.DB;
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildMemoryText(content: string, type: string, ocrResult?: string): string {
    const segments = [content];

    if (type === 'image' && ocrResult) {
      segments.push(ocrResult);
    }

    return segments.filter(Boolean).join('\n');
  }

  private buildSummary(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
  }

  private extractKeywords(text: string): string[] {
    const normalized = this.normalizeText(text);
    const lexicalTokens = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
    const compact = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
    const grams = new Set<string>();

    for (let index = 0; index < compact.length - 1; index += 1) {
      const gram = compact.slice(index, index + 2);
      if (gram.length === 2) {
        grams.add(gram);
      }
      if (grams.size >= 24) {
        break;
      }
    }

    return Array.from(new Set([...lexicalTokens, ...grams])).slice(0, 32);
  }

  private tokenize(text: string): Set<string> {
    return new Set(this.extractKeywords(text));
  }

  private getRecencyScore(updatedAt: unknown): number {
    if (!updatedAt) {
      return 0;
    }

    const updated = new Date(updatedAt as string).getTime();
    if (Number.isNaN(updated)) {
      return 0;
    }

    const ageInDays = Math.max(0, (Date.now() - updated) / (1000 * 60 * 60 * 24));
    return Math.max(0, 1 - ageInDays / 30);
  }

  /**
   * updated_at 的字符串指纹
   *
   * 用 String() 保持「读到什么样的值就配什么样的键」：驱动返回字符串和
   * 写入时传入 Date 两种情况可能对不上，对不上只会导致一次多余的重新
   * 派生（安全），不会造成误命中（不安全）。所以这里不需要也不应该
   * 做时区/格式归一化。
   */
  private stampKey(updatedAt: unknown): string {
    if (updatedAt === null || updatedAt === undefined) {
      return '';
    }

    if (updatedAt instanceof Date) {
      return String(updatedAt.getTime());
    }

    return String(updatedAt);
  }

  /**
   * 从行数据派生评分所需的中间结果（唯一的重活入口）
   *
   * 只在缓存未命中、或 upsertMemory 写入时调用一次。
   */
  private buildMemoryScoreEntry(memoryText: string, keywords: string, updatedAt: unknown): MemoryScoreEntry {
    const normalizedMemory = this.normalizeText(memoryText);

    return {
      stamp: this.stampKey(updatedAt),
      normalizedMemory,
      memoryTokens: new Set((keywords || '').split(/\s+/).filter(Boolean)),
      memoryCharTokens: this.tokenize(normalizedMemory.replace(/\s+/g, '')),
    };
  }

  private putMemoryScoreEntry(id: string, entry: MemoryScoreEntry): void {
    const key = String(id);
    this.memoryScoreCache.delete(key);
    this.memoryScoreCache.set(key, entry);

    while (this.memoryScoreCache.size > MEMORY_SCORE_CACHE_LIMIT) {
      const oldest = this.memoryScoreCache.keys().next();
      if (oldest.done) {
        break;
      }
      this.memoryScoreCache.delete(oldest.value);
    }
  }

  private getMemoryScoreEntry(row: { id: string; memory_text: string; keywords: string; updated_at?: string | Date | null }): MemoryScoreEntry {
    const key = String(row.id);
    const stamp = this.stampKey(row.updated_at);
    const cached = this.memoryScoreCache.get(key);

    if (cached && cached.stamp === stamp) {
      // 命中：重新插到队尾，维持 LRU 顺序
      this.memoryScoreCache.delete(key);
      this.memoryScoreCache.set(key, cached);
      return cached;
    }

    // 未命中或这一行被改写过（stamp 不一致）：重新派生并覆盖旧条目
    const entry = this.buildMemoryScoreEntry(row.memory_text, row.keywords, row.updated_at);
    this.putMemoryScoreEntry(key, entry);
    return entry;
  }

  private deleteMemoryScoreEntry(id: string): void {
    this.memoryScoreCache.delete(String(id));
  }

  /** 查询侧预计算：整轮检索只算一次 */
  private buildQueryScoreInput(query: string): QueryScoreInput {
    const normalizedQuery = this.normalizeText(query);

    return {
      normalizedQuery,
      queryTokens: this.tokenize(normalizedQuery),
      queryCharTokens: this.tokenize(normalizedQuery.replace(/\s+/g, '')),
    };
  }

  private scoreMemory(
    query: QueryScoreInput,
    row: { id: string; memory_text: string; keywords: string; updated_at?: string | Date | null }
  ): number {
    const memory = this.getMemoryScoreEntry(row);

    if (!query.normalizedQuery || !memory.normalizedMemory) {
      return 0;
    }

    let tokenMatches = 0;
    for (const token of query.queryTokens) {
      if (memory.memoryTokens.has(token)) {
        tokenMatches += 1;
      }
    }

    const exactMatch = memory.normalizedMemory.includes(query.normalizedQuery) ? 0.45 : 0;
    const tokenScore = query.queryTokens.size > 0 ? (tokenMatches / query.queryTokens.size) * 0.35 : 0;

    let charMatches = 0;
    for (const token of query.queryCharTokens) {
      if (memory.memoryCharTokens.has(token)) {
        charMatches += 1;
      }
    }
    const charScore = query.queryCharTokens.size > 0 ? (charMatches / query.queryCharTokens.size) * 0.15 : 0;
    const recencyScore = this.getRecencyScore(row.updated_at) * 0.05;

    return Math.min(0.99, exactMatch + tokenScore + charScore + recencyScore);
  }

  private async upsertMemory(
    noteId: number,
    content: string,
    type: string,
    ocrResult?: string
  ): Promise<{ id: string; summary: string; keywords: string[] }> {
    const DB = this.getDB();
    const memoryText = this.buildMemoryText(content, type, ocrResult);
    const summary = this.buildSummary(memoryText);
    const keywords = this.extractKeywords(memoryText);
    const existing = await DB('memory_store').where('note_id', noteId).first();
    const memoryId = existing?.id || randomUUID();
    const now = new Date();

    if (existing) {
      await DB('memory_store').where('note_id', noteId).update({
        content,
        memory_text: memoryText,
        summary,
        keywords: keywords.join(' '),
        type,
        ocr_result: ocrResult || '',
        updated_at: now,
      });
    } else {
      await DB('memory_store').insert({
        id: memoryId,
        note_id: noteId,
        content,
        memory_text: memoryText,
        summary,
        keywords: keywords.join(' '),
        type,
        ocr_result: ocrResult || '',
        created_at: now,
        updated_at: now,
      });
    }

    // 写入路径已经算过一遍派生数据了，直接喂给缓存：
    // 下一轮检索不用再为这一行重跑 normalizeText + tokenize，
    // 同时覆盖掉旧 stamp 的条目（重复 upsert 不会读到过期 token）
    this.putMemoryScoreEntry(
      memoryId,
      this.buildMemoryScoreEntry(memoryText, keywords.join(' '), now)
    );

    return { id: memoryId, summary, keywords };
  }


  async addNote(
    noteId: number,
    content: string,
    type: string,
    ocrResult: string | undefined,
    aiConfig?: AiConfig
  ): Promise<{ success: boolean; vectorId?: string; error?: string }> {
    try {
      await this.ensureInitialized();

      // 准备要索引的文本
      let textToIndex = content;
      if (type === 'image' && ocrResult) {
        textToIndex = ocrResult;
      }

      // 如果文本为空，不索引
      if (!textToIndex || textToIndex.trim() === '') {
        return { success: false, error: 'No content to index' };
      }

      const memory = await this.upsertMemory(noteId, content, type, ocrResult);

      log.info(`Added note ${noteId} to memory store with ID ${memory.id}`, {
        summary: memory.summary,
        keywordCount: memory.keywords.length,
      });
      return { success: true, vectorId: memory.id };
    } catch (error) {
      log.error('Error adding note to memory store:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchSimilar(
    query: string,
    topK: number,
    aiConfig?: AiConfig
  ): Promise<{ success: boolean; results?: VectorSearchResult[]; error?: string }> {
    try {
      await this.ensureInitialized();

      const rows = await this.getDB()('memory_store')
        .select('id', 'note_id', 'content', 'type', 'ocr_result', 'memory_text', 'keywords', 'updated_at');

      // 查询侧只算一次，循环里逐行复用（tokenize 是纯函数，结果不变）
      const queryInput = this.buildQueryScoreInput(query);

      const results = rows
        .map((row) => {
          const similarity = this.scoreMemory(queryInput, row);
          return {
            id: row.id as string,
            noteId: Number(row.note_id),
            content: row.content as string,
            type: (row.type as string) || 'text',
            ocr_result: (row.ocr_result as string) || undefined,
            distance: Math.max(0.01, Number((1 - similarity).toFixed(4))),
            similarity,
          };
        })
        .filter((row) => row.similarity > MEMORY_MIN_SIMILARITY)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, topK)
        .map(({ similarity, ...result }) => result);

      log.info(`Memory search found ${results.length} results`);
      return { success: true, results };
    } catch (error) {
      log.error('Error searching memory store:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteNote(vectorId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();

      await this.getDB()('memory_store').where('id', vectorId).delete();
      this.deleteMemoryScoreEntry(vectorId);

      log.info(`Deleted memory ${vectorId} from store`);
      return { success: true };
    } catch (error) {
      log.error('Error deleting from memory store:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async clearAll(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureInitialized();

      await this.getDB()('memory_store').delete();
      this.memoryScoreCache.clear();
      log.info('Cleared all memories from store');
      return { success: true };
    } catch (error) {
      log.error('Error clearing memory store:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getCount(): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      await this.ensureInitialized();

      const result = await this.getDB()('memory_store').count<{ count: number }[]>({ count: '*' }).first();
      const count = Number(result?.count || 0);
      return { success: true, count };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Memory store not initialized') || message.includes('VectorStore database has not been initialized')) {
        log.warn('Memory store is unavailable when reading count, returning 0', { message });
        return { success: true, count: 0, error: message };
      }

      log.error('Error getting memory count:', error);
      return { success: false, error: message };
    }
  }
}

export const vectorStore = new VectorStore();