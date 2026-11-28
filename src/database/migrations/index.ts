import { log } from "../../main/core/system/log";
import { getDB } from "../index";
import { DEFAULT_AI_CHAT_SESSION_ID } from "../../shared/ai/constants/aiChat";
import { buildSessionPreview } from "../../main/core/ai/nativeAi";
import { contentHash } from "../../main/core/notes/nativeNotes";
import type { Knex } from "knex";

async function createNotesTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("note", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.text("content").notNullable();
      table.string("type").defaultTo("text");
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("笔记表创建成功");
  } catch (err) {
    log.error("创建笔记表失败:", err);
    throw err;
  }
}

async function createSettingsTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("settings", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.string("configName").notNullable().unique();
      table.string("configValue").notNullable();
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("设置表创建成功");
  } catch (err) {
    log.error("创建设置表失败:", err);
    throw err;
  }
}

async function createDocumentsTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("document", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.string("title").notNullable();
      table.text("content").notNullable();
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("文档表创建成功");
  } catch (err) {
    log.error("创建文档表失败:", err);
    throw err;
  }
}

async function createTemplatesTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("template", (table: Knex.TableBuilder) => {
      table.string("id").primary();
      table.string("name").notNullable();
      table.text("content").notNullable();
      table.string("category").notNullable();
      table.boolean("is_custom").defaultTo(true);
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("模板表创建成功");
  } catch (err) {
    log.error("创建模板表失败:", err);
    throw err;
  }
}

async function createAiChatTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("ai_chat", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.string("role").notNullable();
      table.text("content").notNullable();
      table.integer("compressed").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(DB.fn.now());
    });
    log.info("AI聊天表创建成功");
  } catch (err) {
    log.error("创建AI聊天表失败:", err);
    throw err;
  }
}

async function createAiChatSessionsTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("ai_chat_session", (table: Knex.TableBuilder) => {
      table.string("id").primary();
      table.string("title").notNullable();
      table.text("preview").notNullable().defaultTo("");
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("AI聊天会话表创建成功");
  } catch (err) {
    log.error("创建AI聊天会话表失败:", err);
    throw err;
  }
}

async function createAiChatSummaryTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("ai_chat_summary", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.string("session_id").notNullable();
      table.integer("from_message_id").notNullable();
      table.integer("to_message_id").notNullable();
      table.text("summary").notNullable();
      table.integer("compressed_count").notNullable().defaultTo(0);
      table.integer("compressed_chars").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(DB.fn.now());

      table.index(["session_id", "id"], "ai_chat_summary_session_idx");
    });
    log.info("AI聊天摘要表创建成功");
  } catch (err) {
    log.error("创建AI聊天摘要表失败:", err);
    throw err;
  }
}

async function createAiUsageLogTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("ai_usage_log", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.string("provider").notNullable();
      table.string("model").notNullable().defaultTo("");
      table.string("session_id");
      table.integer("agent_iteration").notNullable().defaultTo(0);
      table.integer("prompt_tokens").notNullable().defaultTo(0);
      table.integer("completion_tokens").notNullable().defaultTo(0);
      table.integer("total_tokens").notNullable().defaultTo(0);
      table.integer("latency_ms").notNullable().defaultTo(0);
      table.boolean("success").notNullable().defaultTo(true);
      table.string("error_type").notNullable().defaultTo("");
      table.text("error_message").notNullable().defaultTo("");
      table.string("kind").notNullable().defaultTo("llm");
      table.timestamp("created_at").defaultTo(DB.fn.now());

      table.index(["session_id", "id"], "ai_usage_log_session_idx");
      table.index(["created_at"], "ai_usage_log_created_idx");
    });
    log.info("AI用量日志表创建成功");
  } catch (err) {
    log.error("创建AI用量日志表失败:", err);
    throw err;
  }
}

const SESSION_ID_BACKFILL_FLAG = "ai_chat_session_id_backfilled_v1";

async function addAiChatSessionIdColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(ai_chat)");
    if (!columns.some((column: any) => column.name === "session_id")) {
      await DB.raw("ALTER TABLE ai_chat ADD COLUMN session_id TEXT");
    }

    if (!columns.some((column: any) => column.name === "compressed")) {
      await DB.raw("ALTER TABLE ai_chat ADD COLUMN compressed INTEGER NOT NULL DEFAULT 0");
      log.info("已为 ai_chat 表添加 compressed 字段（会话压缩软删除标记）");
    }
    await DB.raw("CREATE INDEX IF NOT EXISTS ai_chat_session_compressed_idx ON ai_chat(session_id, compressed)");

    const backfilled = await DB("settings")
      .where("configName", SESSION_ID_BACKFILL_FLAG)
      .first();

    const unassignedMessages = backfilled
      ? []
      : await DB.from("ai_chat")
          .whereNull("session_id")
          .orderBy("created_at", "asc")
          .orderBy("id", "asc");

    if (unassignedMessages.length > 0) {
      const firstUserMessage = unassignedMessages.find((message: any) => message.role === "user");
      const lastMessage = unassignedMessages[unassignedMessages.length - 1];
      const title = String(firstUserMessage?.content ?? "历史对话")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48) || "历史对话";
      const createdAt = new Date(unassignedMessages[0].created_at || Date.now());
      const updatedAt = new Date(lastMessage.created_at || Date.now());
      const lastUserMessage = [...unassignedMessages]
        .reverse()
        .find((message: any) => message.role === "user");
      const preview = buildSessionPreview(
        lastUserMessage?.content ?? lastMessage.content
      );

      await DB.transaction(async (transaction) => {
        const existingSession = await transaction("ai_chat_session")
          .where({ id: DEFAULT_AI_CHAT_SESSION_ID })
          .first();

        if (existingSession) {
          await transaction("ai_chat_session")
            .where({ id: DEFAULT_AI_CHAT_SESSION_ID })
            .update({ title, preview, updated_at: updatedAt });
        } else {
          await transaction("ai_chat_session").insert({
            id: DEFAULT_AI_CHAT_SESSION_ID,
            title,
            preview,
            created_at: createdAt,
            updated_at: updatedAt,
          });
        }

        await transaction("ai_chat")
          .whereNull("session_id")
          .update({ session_id: DEFAULT_AI_CHAT_SESSION_ID });
      });
    }

    if (!backfilled) {
      await DB("settings")
        .insert({
          configName: SESSION_ID_BACKFILL_FLAG,
          configValue: String(Date.now()),
        })
        .onConflict("configName")
        .merge({ configValue: String(Date.now()) });
    }

    await DB.raw("CREATE INDEX IF NOT EXISTS ai_chat_session_id_idx ON ai_chat(session_id)");
  } catch (err) {
    log.error("添加AI聊天会话字段失败:", err);
  }
}

async function addAiChatBlocksColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(ai_chat)");
    if (!columns.some((column: any) => column.name === "blocks")) {
      await DB.raw("ALTER TABLE ai_chat ADD COLUMN blocks TEXT DEFAULT ''");
      log.info("已为 ai_chat 表添加 blocks 字段（AI 回复有序分块）");
    }
  } catch (err) {
    log.error("添加AI回复分块字段失败:", err);
  }
}

async function addAiChatImagesColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(ai_chat)");
    if (!columns.some((column: any) => column.name === "images")) {
      await DB.raw("ALTER TABLE ai_chat ADD COLUMN images TEXT DEFAULT ''");
      log.info("已为 ai_chat 表添加 images 字段（AI 消息图片附件）");
    }
  } catch (err) {
    log.error("添加AI消息图片字段失败:", err);
  }
}

async function createTodosTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("todo", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.text("title").notNullable();
      table.text("notes");
      table.string("priority").defaultTo("medium");
      table.timestamp("due_date");
      table.boolean("completed").defaultTo(false);
      table.timestamp("completed_at");
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
      table.text("attachments").defaultTo("[]");
      table.timestamp("archived_at");
    });
    log.info("Todo表创建成功");
  } catch (err) {
    log.error("创建Todo表失败:", err);
    throw err;
  }
}

async function addTodoAttachmentsColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(todo)");
    const hasAttachmentsColumn = columns.some((col: any) => col.name === "attachments");
    if (!hasAttachmentsColumn) {
      await DB.raw("ALTER TABLE todo ADD COLUMN attachments TEXT DEFAULT '[]'");
      log.info("已为 todo 表添加 attachments 字段");
    } else {
      log.info("todo 表的 attachments 字段已存在");
    }
  } catch (err) {
    log.error("添加 todo attachments 字段失败", err);
  }
}

async function addTodoArchivedAtColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(todo)");
    const hasArchivedAtColumn = columns.some((col: any) => col.name === "archived_at");
    if (!hasArchivedAtColumn) {
      await DB.raw("ALTER TABLE todo ADD COLUMN archived_at TIMESTAMP DEFAULT NULL");
      log.info("已为 todo 表添加 archived_at 字段");
    } else {
      log.info("todo 表的 archived_at 字段已存在");
    }
  } catch (err) {
    log.error("添加 todo archived_at 字段失败", err);
  }
}

async function addTodoReminderColumns(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(todo)");
    const names = columns.map((col: any) => col.name);
    if (!names.includes("remind_at")) {
      await DB.raw("ALTER TABLE todo ADD COLUMN remind_at TIMESTAMP DEFAULT NULL");
      log.info("已为 todo 表添加 remind_at 字段（提醒时间）");
    }
    if (!names.includes("reminded_at")) {
      await DB.raw("ALTER TABLE todo ADD COLUMN reminded_at TIMESTAMP DEFAULT NULL");
      log.info("已为 todo 表添加 reminded_at 字段（提醒已触发时间）");
    }
    await DB.raw(
      "CREATE INDEX IF NOT EXISTS todo_remind_at_idx ON todo(remind_at)"
    );
  } catch (err) {
    log.error("添加 todo 提醒时间字段失败", err);
  }
}

async function createVectorStoreTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("vector_store", (table: Knex.TableBuilder) => {
      table.string("id").primary();
      table.integer("note_id").notNullable();
      table.text("content").notNullable();
      table.string("type").notNullable();
      table.text("ocr_result");
      table.text("embedding").notNullable();
      table.timestamp("created_at").defaultTo(DB.fn.now());

      table.foreign("note_id").references("id").inTable("note").onDelete("CASCADE");
    });
    log.info("向量存储表创建成功");
  } catch (err) {
    log.error("创建向量存储表失败:", err);
    throw err;
  }
}

async function createMemoryStoreTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("memory_store", (table: Knex.TableBuilder) => {
      table.string("id").primary();
      table.integer("note_id").notNullable().unique();
      table.text("content").notNullable();
      table.text("memory_text").notNullable();
      table.text("summary").notNullable().defaultTo("");
      table.text("keywords").notNullable().defaultTo("");
      table.string("type").notNullable();
      table.text("ocr_result").defaultTo("");
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());

      table.foreign("note_id").references("id").inTable("note").onDelete("CASCADE");
    });
    log.info("记忆存储表创建成功");
  } catch (err) {
    log.error("创建记忆存储表失败:", err);
    throw err;
  }
}

async function createBookmarksTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("browser_bookmark", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.text("title");
      table.text("url").notNullable();
      table.unique(["url"]);
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("浏览器书签表创建成功");
  } catch (err) {
    log.error("创建浏览器书签表失败:", err);
    throw err;
  }
}

async function createShortcutTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("shortcut", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.string("kind").notNullable();
      table.text("target").notNullable();
      table.text("title").notNullable();
      table.integer("sort_order").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("快捷方式表创建成功");
  } catch (err) {
    log.error("创建快捷方式表失败:", err);
    throw err;
  }
}

async function ensureTable(DB: Knex, tableName: string, creator: (DB: Knex) => Promise<void>): Promise<void> {
  try {
    const hasTable = await DB.schema.hasTable(tableName);
    if (!hasTable) {
      log.info(`创建${tableName}表...`);
      await creator(DB);
    } else {
      log.info(`${tableName}表已存在`);
    }
  } catch (err) {
    log.error(`创建${tableName}表时出错:`, err);
  }
}

async function createPluginTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("plugin", (table: Knex.TableBuilder) => {
      table.increments("local_id").primary();
      table.text("id").notNullable().unique();
      table.text("name").notNullable();
      table.text("version").notNullable().defaultTo("0.0.1");
      table.text("publisher").notNullable().defaultTo("");
      table.text("description");
      table.text("path").notNullable().unique();
      table.string("status").notNullable().defaultTo("missing-manifest");
      table.text("manifest_text");
      table.text("command");
      table.text("preview");
      table.text("error");
      table.text("runtime_json");
      table.text("capabilities_json");
      table.text("contributes_json");
      table.string("origin").notNullable().defaultTo("local");
      table.integer("enabled").notNullable().defaultTo(1);
      table.string("confirmed_manifest_hash").notNullable().defaultTo("");
      table.integer("sort_order").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("插件表创建成功");
  } catch (err) {
    log.error("创建插件表失败:", err);
    throw err;
  }
}

async function createPluginSettingTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("plugin_setting", (table: Knex.TableBuilder) => {
      table.text("plugin_id").notNullable();
      table.text("key").notNullable();
      table.text("value");
      table.primary(["plugin_id", "key"]);
    });
    log.info("插件设置表创建成功");
  } catch (err) {
    log.error("创建插件设置表失败:", err);
    throw err;
  }
}

async function createPluginGrantTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("plugin_grant", (table: Knex.TableBuilder) => {
      table.text("plugin_id").notNullable();
      table.text("capability").notNullable();
      table.integer("granted").notNullable().defaultTo(0);
      table.timestamp("granted_at");
      table.primary(["plugin_id", "capability"]);
    });
    log.info("插件授权表创建成功");
  } catch (err) {
    log.error("创建插件授权表失败:", err);
    throw err;
  }
}

async function migratePluginSchema(DB: Knex): Promise<void> {
  try {
    await ensureTable(DB, "plugin", createPluginTable);
    await ensureTable(DB, "plugin_setting", createPluginSettingTable);
    await ensureTable(DB, "plugin_grant", createPluginGrantTable);

    await DB.raw("DROP TABLE IF EXISTS app_workspace");
  } catch (err) {
    log.error("迁移插件表结构失败:", err);
  }
}

async function addNoteTableColumns(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(note)");
    const hasPinnedColumn = columns.some((col: any) => col.name === 'is_pinned_to_ai');
    const hasOcrResultColumn = columns.some((col: any) => col.name === 'ocr_result');
    const hasVectorIndexedColumn = columns.some((col: any) => col.name === 'vector_indexed');
    const hasVectorIdColumn = columns.some((col: any) => col.name === 'vector_id');
    const hasPinnedAtColumn = columns.some((col: any) => col.name === 'pinned_at');
    const hasImportantColumn = columns.some((col: any) => col.name === 'is_important');

    if (!hasPinnedColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN is_pinned_to_ai INTEGER DEFAULT 0");
      log.info("已为note表添加is_pinned_to_ai字段");
    } else {
      log.info("note表的is_pinned_to_ai字段已存在");
    }

    if (!hasOcrResultColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN ocr_result TEXT DEFAULT ''");
      log.info("已为note表添加ocr_result字段");
    } else {
      log.info("note表的ocr_result字段已存在");
    }

    if (!hasVectorIndexedColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN vector_indexed INTEGER DEFAULT 0");
      log.info("已为note表添加vector_indexed字段");
    } else {
      log.info("note表的vector_indexed字段已存在");
    }

    if (!hasVectorIdColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN vector_id TEXT DEFAULT ''");
      log.info("已为note表添加vector_id字段");
    } else {
      log.info("note表的vector_id字段已存在");
    }

    if (!hasPinnedAtColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN pinned_at INTEGER DEFAULT NULL");
      log.info("已为note表添加pinned_at字段");
    } else {
      log.info("note表的pinned_at字段已存在");
    }

    if (!hasImportantColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN is_important INTEGER NOT NULL DEFAULT 0");
      log.info("已为note表添加is_important字段");
    } else {
      log.info("note表的is_important字段已存在");
    }
  } catch (err) {
    log.error("添加note表字段时出错:", err);
  }
}

const PREVIEW_BACKFILL_FLAG = "ai_session_preview_backfilled_v2";

async function backfillAiSessionPreviews(DB: Knex): Promise<void> {
  try {
    const done = await DB("settings").where({ configName: PREVIEW_BACKFILL_FLAG }).first();
    if (done) return;

    const sessions = await DB("ai_chat_session").select("id");
    let updated = 0;

    for (const session of sessions) {
      const lastUser = await DB("ai_chat")
        .where({ session_id: session.id, role: "user" })
        .orderBy("id", "desc")
        .first("content");
      if (!lastUser?.content) continue;

      const preview = buildSessionPreview(lastUser.content);
      if (!preview) continue;

      await DB("ai_chat_session").where({ id: session.id }).update({ preview });
      updated++;
    }

    await DB("settings").insert({
      configName: PREVIEW_BACKFILL_FLAG,
      configValue: String(Date.now()),
    });
    log.info(`AI 会话预览已按用户消息回填，共 ${updated} 条`);
  } catch (err) {
    log.error("回填 AI 会话预览失败:", err);
  }
}

async function addNotePerformanceIndexes(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(note)");
    const hasContentHashColumn = columns.some((col: any) => col.name === "content_hash");

    if (!hasContentHashColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN content_hash TEXT DEFAULT ''");
      log.info("已为note表添加content_hash字段");
    }

    const pending = await DB("note")
      .where("content_hash", "")
      .orWhereNull("content_hash")
      .select("id", "content");

    if (pending.length > 0) {
      log.info(`正在回填 ${pending.length} 条笔记的content_hash`);

      const BATCH = 500;
      for (let i = 0; i < pending.length; i += BATCH) {
        const batch = pending.slice(i, i + BATCH);
        for (const row of batch) {
          await DB("note")
            .where("id", row.id)
            .update({ content_hash: contentHash(row.content ?? "") });
        }
      }
      log.info("content_hash 回填完成");
    }

    await DB.raw(
      "CREATE INDEX IF NOT EXISTS note_content_hash_idx ON note(content_hash, type)"
    );
    await DB.raw(
      "CREATE INDEX IF NOT EXISTS note_created_at_idx ON note(created_at DESC)"
    );
    log.info("note表索引已就绪");
  } catch (err) {
    log.error("添加note表性能索引时出错:", err);
  }
}

export async function migrateRun(path?: string): Promise<void> {
  try {
    let DB: Knex;
    if (path) {
      DB = getDB(path);
    } else {
      DB = getDB();
    }

    try {
      await DB.raw("PRAGMA journal_mode = WAL;");
      await DB.raw("PRAGMA synchronous = NORMAL;");
      log.info("设置数据库模式为WAL + synchronous=NORMAL，提高性能");
    } catch (pragmaErr) {
      log.warn("设置数据库模式失败，继续使用默认模式:", pragmaErr);
    }

    await ensureTable(DB, "note", createNotesTable);
    await ensureTable(DB, "settings", createSettingsTable);
    await ensureTable(DB, "document", createDocumentsTable);
    await ensureTable(DB, "template", createTemplatesTable);
    await ensureTable(DB, "ai_chat", createAiChatTable);
    await ensureTable(DB, "ai_chat_session", createAiChatSessionsTable);
    await ensureTable(DB, "ai_chat_summary", createAiChatSummaryTable);
    await ensureTable(DB, "ai_usage_log", createAiUsageLogTable);
    await addAiChatSessionIdColumn(DB);

    await addAiChatBlocksColumn(DB);

    await addAiChatImagesColumn(DB);

    await backfillAiSessionPreviews(DB);

    await ensureTable(DB, "todo", createTodosTable);

    await addTodoAttachmentsColumn(DB);

    await addTodoArchivedAtColumn(DB);

    await addTodoReminderColumns(DB);

    await addNoteTableColumns(DB);

    await addNotePerformanceIndexes(DB);

    await ensureTable(DB, "vector_store", createVectorStoreTable);

    await ensureTable(DB, "memory_store", createMemoryStoreTable);

    await ensureTable(DB, "browser_bookmark", createBookmarksTable);

    await ensureTable(DB, "shortcut", createShortcutTable);

    await migratePluginSchema(DB);
    log.info("数据库迁移成功完成");
  } catch (err) {
    log.info("数据库迁移过程中发生错误:", err);
  }
}

