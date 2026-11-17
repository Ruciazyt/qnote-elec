import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { log } from '../system/log';

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

const MEMORY_MIN_SIMILARITY = 0.1;

const MEMORY_SCORE_CACHE_LIMIT = 2000;

interface MemoryScoreEntry {
  stamp: string;
  normalizedMemory: string;
  memoryTokens: Set<string>;
  memoryCharTokens: Set<string>;
}

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
  private memoryScoreCache = new Map<string, MemoryScoreEntry>();

  init(DB: Knex) {
    this.DB = DB;
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

  private stampKey(updatedAt: unknown): string {
    if (updatedAt === null || updatedAt === undefined) {
      return '';
    }

    if (updatedAt instanceof Date) {
      return String(updatedAt.getTime());
    }

    return String(updatedAt);
  }

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
      this.memoryScoreCache.delete(key);
      this.memoryScoreCache.set(key, cached);
      return cached;
    }

    const entry = this.buildMemoryScoreEntry(row.memory_text, row.keywords, row.updated_at);
    this.putMemoryScoreEntry(key, entry);
    return entry;
  }

  private deleteMemoryScoreEntry(id: string): void {
    this.memoryScoreCache.delete(String(id));
  }

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
    _aiConfig?: AiConfig
  ): Promise<{ success: boolean; vectorId?: string; error?: string }> {
    try {
      await this.ensureInitialized();

      let textToIndex = content;
      if (type === 'image' && ocrResult) {
        textToIndex = ocrResult;
      }

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
    _aiConfig?: AiConfig
  ): Promise<{ success: boolean; results?: VectorSearchResult[]; error?: string }> {
    try {
      await this.ensureInitialized();

      const rows = await this.getDB()('memory_store')
        .select('id', 'note_id', 'content', 'type', 'ocr_result', 'memory_text', 'keywords', 'updated_at');

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
        .map(({ similarity: _similarity, ...result }) => result);

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