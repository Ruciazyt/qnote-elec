import { log } from "../../main/utils/log";
import { getDB } from "../index";
import { DEFAULT_AI_CHAT_SESSION_ID } from "../../shared/constants/aiChat";
import { buildSessionPreview } from "../../shared/aiSessionPreview";
import { contentHash } from "../../shared/noteHash";
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
      table.string("role").notNullable(); // 'user' | 'assistant' | 'system'
      table.text("content").notNullable();
      // 软删除标记（被压缩进摘要的原始消息，0=未压缩 1=已压缩）
      // 新表默认全部为 0；老库由 addAiChatSessionIdColumn 里的 ALTER 补列
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
      // 所属会话（对应 ai_chat_session.id）
      table.string("session_id").notNullable();
      // 这一轮压缩覆盖的原始消息范围（闭区间，按 ai_chat.id 计）
      table.integer("from_message_id").notNullable();
      table.integer("to_message_id").notNullable();
      // 压缩后的摘要正文
      table.text("summary").notNullable();
      // 被压缩掉的原始消息条数（用于统计/调试）
      table.integer("compressed_count").notNullable().defaultTo(0);
      // 被压缩掉的原始消息总字符数
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
      // provider: openai / claude（含兼容 provider 归一化前的原始值）
      table.string("provider").notNullable();
      table.string("model").notNullable().defaultTo("");
      // 对话会话（关联 ai_chat_session.id），压缩/流式等无会话的调用为 NULL
      table.string("session_id");
      // 这次调用在 agent 循环里的第几轮（0 = 单次调用）
      table.integer("agent_iteration").notNullable().defaultTo(0);
      // token 用量
      table.integer("prompt_tokens").notNullable().defaultTo(0);
      table.integer("completion_tokens").notNullable().defaultTo(0);
      table.integer("total_tokens").notNullable().defaultTo(0);
      // 延迟（毫秒）
      table.integer("latency_ms").notNullable().defaultTo(0);
      // 成功/失败
      table.boolean("success").notNullable().defaultTo(true);
      // 错误分类（见 src/main/utils/ai/observability/usageRecorder.ts）
      table.string("error_type").notNullable().defaultTo("");
      table.text("error_message").notNullable().defaultTo("");
      // 是否是工具调用相关的记录
      table.string("kind").notNullable().defaultTo("llm"); // llm | tool
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

async function addAiChatSessionIdColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(ai_chat)");
    if (!columns.some((column: any) => column.name === "session_id")) {
      await DB.raw("ALTER TABLE ai_chat ADD COLUMN session_id TEXT");
    }

    // 软删除标记 —— 被压缩进摘要的原始消息不删，只标记
    // 热记忆（getHotState）只读 compressed=0；前端历史列表读全部
    if (!columns.some((column: any) => column.name === "compressed")) {
      await DB.raw("ALTER TABLE ai_chat ADD COLUMN compressed INTEGER NOT NULL DEFAULT 0");
      log.info("已为 ai_chat 表添加 compressed 字段（会话压缩软删除标记）");
    }
    await DB.raw("CREATE INDEX IF NOT EXISTS ai_chat_session_compressed_idx ON ai_chat(session_id, compressed)");

    const unassignedMessages = await DB.from("ai_chat")
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
      // 历史消息优先取用户输入作为预览（与新会话的规则保持一致）
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

    await DB.raw("CREATE INDEX IF NOT EXISTS ai_chat_session_id_idx ON ai_chat(session_id)");
  } catch (err) {
    log.error("添加AI聊天会话字段失败:", err);
  }
}

/**
 * 给 ai_chat 补 blocks 列 —— 存这一条 AI 回复的有序分块
 *
 * 内容是 JSON 数组，按真实发生顺序排着 思考 / 工具调用 / 输出：
 *   [{kind:'thinking'},{kind:'tool'},{kind:'text'}, …]
 *
 * 为什么不用「content 字符串 + 工具数组」两个字段拼 —— 那样只能把工具统一塞到
 * 正文前或后，交错顺序丢了，而交错顺序在重启后无法重建。
 *
 * 为什么不另起 role='tool' 的行：rowToMessage 会把非 assistant/system 的 role
 * 一律映射成 HumanMessage，于是工具记录会被当成「用户说的话」重新喂回模型，
 * 而且没有 tool_call_id 配对，OpenAI/Anthropic 都会拒绝这个序列。
 *
 * 这一列不会泄漏进 prompt —— rebuildHotState 是显式 .select('id','role','content')，
 * 新列根本进不了热内存。
 */
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

/**
 * 给 ai_chat 补 images 列 —— 存这一条消息带上的图片附件
 *
 * 内容是 JSON 数组：[{"mime":"image/png","data":"<base64>","name":"a.png"}, …]
 *
 * 为什么不塞进 content：content 是纯文本列，历史列表、压缩器、
 * 会话预览都按纯文本读它。图片走独立的一列，读历史时按需还原成
 * content 块（见 hotMemory.rowToMessage），互不干扰。
 *
 * 体积换来的代价很直白：一张 1568px 的图约几百 KB。一条消息最多 4 张，
 * 一轮问答 4MB 出头。SQLite 扛得住，代价是磁盘占用比纯文本对话高一个量级。
 */
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
      // 附件列表 — 存储为 JSON 字符串，包含 image 等类型附件的 dataUrl
      table.text("attachments").defaultTo("[]");
    });
    log.info("Todo表创建成功");
  } catch (err) {
    log.error("创建Todo表失败:", err);
    throw err;
  }
}

// 为已存在的 todo 表添加 attachments 字段（兼容旧版本数据库）
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

async function createVectorStoreTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("vector_store", (table: Knex.TableBuilder) => {
      table.string("id").primary();
      table.integer("note_id").notNullable();
      table.text("content").notNullable();
      table.string("type").notNullable();
      table.text("ocr_result");
      table.text("embedding").notNullable(); // 存储为JSON字符串
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

async function createLeetcodeCollectionTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("leetcode_collection", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.string("name").notNullable();
      table.text("summary").defaultTo("");
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
    log.info("题单表创建成功");
  } catch (err) {
    log.error("创建题单表失败:", err);
    throw err;
  }
}

async function createLeetcodeProblemTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("leetcode_problem", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      table.integer("collection_id").notNullable();
      table.string("link").notNullable();
      table.string("title").defaultTo("");
      table.string("difficulty").defaultTo("");
      table.boolean("is_completed").defaultTo(false);
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());

      table.foreign("collection_id").references("id").inTable("leetcode_collection").onDelete("CASCADE");
    });
    log.info("题目表创建成功");
  } catch (err) {
    log.error("创建题目表失败:", err);
    throw err;
  }
}

// 为 leetcode_problem 表添加 title 字段
async function addLeetcodeProblemTitleColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(leetcode_problem)");
    const hasTitleColumn = columns.some((col: any) => col.name === "title");

    if (!hasTitleColumn) {
      await DB.raw("ALTER TABLE leetcode_problem ADD COLUMN title TEXT DEFAULT ''");
      log.info("已为leetcode_problem表添加title字段");
    } else {
      log.info("leetcode_problem表的title字段已存在");
    }
  } catch (err) {
    log.error("添加leetcode_problem表字段时出错:", err);
    // 不抛出错误，允许继续执行
  }
}

// 为 leetcode_problem 表添加 difficulty 字段
async function addLeetcodeProblemDifficultyColumn(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(leetcode_problem)");
    const hasDifficultyColumn = columns.some((col: any) => col.name === "difficulty");

    if (!hasDifficultyColumn) {
      await DB.raw("ALTER TABLE leetcode_problem ADD COLUMN difficulty TEXT DEFAULT ''");
      log.info("已为leetcode_problem表添加difficulty字段");
    } else {
      log.info("leetcode_problem表的difficulty字段已存在");
    }
  } catch (err) {
    log.error("添加leetcode_problem表difficulty字段时出错:", err);
    // 不抛出错误，允许继续执行
  }
}

async function createBookmarksTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("browser_bookmark", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      /** 页面标题 —— 允许为空（部分站点取不到 title） */
      table.text("title");
      table.text("url").notNullable();
      /** 同一 URL 只收藏一次，用唯一索引兜住重复收藏 */
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

/**
 * 主页快捷方式表
 *
 * 三种类型共用一张表，用 kind 区分：网页链接 / 本地程序 / 本地文件夹。
 * target 存的是绝对路径或完整 URL —— 快捷方式的语义就是"指向一个具体的东西"，
 * 存相对路径会在用户移动目录后集体失效。
 */
async function createShortcutTable(DB: Knex): Promise<void> {
  try {
    await DB.schema.createTable("shortcut", (table: Knex.TableBuilder) => {
      table.increments("id").primary();
      /** 'url' | 'app' | 'folder' */
      table.string("kind").notNullable();
      /** URL 或绝对路径 */
      table.text("target").notNullable();
      /** 展示名，用户没填时主进程按 target 推导一个 */
      table.text("title").notNullable();
      /**
       * 排序位。拖拽结束时主进程按新顺序整体重排为 0..n-1，
       * 而不是做两两交换 —— 后者会在并发重排或中途失败时留下重复的 sort_order，
       * 让列表顺序变得不确定且无法自愈。
       */
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

// 检查并创建单个表，附带错误处理
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
    // 不抛出错误，允许其他表继续创建
  }
}

// 为note表添加新字段
async function addNoteTableColumns(DB: Knex): Promise<void> {
  try {
    // 检查各字段是否存在
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

    // 置顶时间（毫秒时间戳），NULL 表示未置顶。
    // 存时间而不是布尔位：多条置顶之间要按置顶先后排序，一个 0/1 排不出顺序。
    if (!hasPinnedAtColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN pinned_at INTEGER DEFAULT NULL");
      log.info("已为note表添加pinned_at字段");
    } else {
      log.info("note表的pinned_at字段已存在");
    }

    // 重要标记。与 pinned_at 的区别：置顶管的是「排在最前」，
    // 重要管的是「清空时别删我」—— 两者都参与 delete-all-notes 的保留判定。
    if (!hasImportantColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN is_important INTEGER NOT NULL DEFAULT 0");
      log.info("已为note表添加is_important字段");
    } else {
      log.info("note表的is_important字段已存在");
    }
  } catch (err) {
    log.error("添加note表字段时出错:", err);
    // 不抛出错误，允许继续执行
  }
}

/**
 * 一次性回填 AI 会话预览
 *
 * 历史版本的 preview 取自助手回复，会话列表里因此塞满了模型推理
 * （<think>…</think> 直接可见）和客套话。preview 是派生字段，真正的
 * 来源在 ai_chat 里存着的用户消息 —— 这里按会话用"最近一条用户消息"
 * 重算一次。
 *
 * 用 settings 里的一行做标记，保证只跑一次，不在每次启动时重扫全表。
 */
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
    // 回填失败不该挡住启动 —— 只是预览不好看，功能不受影响
    log.error("回填 AI 会话预览失败:", err);
  }
}

/**
 * 给 note 表补上 content_hash 列并建索引
 *
 * ## 为什么
 *
 * note 是全应用最热的表：剪贴板每 2 秒去重一次、列表按 created_at 倒序翻页。
 * 而它原本一个索引都没有 —— content 是 TEXT 且存着图片 base64（单条几百 KB 起），
 * SQLite 对 TEXT 等值比较用不上索引，于是每次剪贴板事件都是一次全表扫描，
 * 把所有历史图片的字节读一遍再丢掉。
 *
 * 加一列定长哈希并索引后，等值查找走索引，只回读命中的那一行。
 * created_at 索引则让列表的 ORDER BY 不再触发排序。
 */
async function addNotePerformanceIndexes(DB: Knex): Promise<void> {
  try {
    const columns = await DB.raw("PRAGMA table_info(note)");
    const hasContentHashColumn = columns.some((col: any) => col.name === "content_hash");

    if (!hasContentHashColumn) {
      await DB.raw("ALTER TABLE note ADD COLUMN content_hash TEXT DEFAULT ''");
      log.info("已为note表添加content_hash字段");
    }

    // 回填历史数据。分批提交，避免大库一次性把事务撑爆。
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

    // 去重查询：where content_hash = ? and type = ?
    await DB.raw(
      "CREATE INDEX IF NOT EXISTS note_content_hash_idx ON note(content_hash, type)"
    );
    // 列表查询：order by created_at desc limit 100
    await DB.raw(
      "CREATE INDEX IF NOT EXISTS note_created_at_idx ON note(created_at DESC)"
    );
    log.info("note表索引已就绪");
  } catch (err) {
    log.error("添加note表性能索引时出错:", err);
    // 不抛出错误，允许继续执行
  }
}

export async function migrateRun(path?: string): Promise<void> {
  try {
    // 获取数据库连接
    let DB: Knex;
    if (path) {
      DB = getDB(path);
    } else {
      DB = getDB();
    }

    // 执行预检查
    try {
      await DB.raw("PRAGMA journal_mode = WAL;");
      // WAL 的标准搭档。默认 synchronous=FULL 会在每次提交时 fsync，
      // 而剪贴板每 2 秒就可能插一条几百 KB 的图片，等于不停刷盘。
      // NORMAL 在 WAL 下只在 checkpoint 边界丢数据，进程崩溃不丢，
      // 操作系统崩溃理论上丢最后一次提交 —— 对剪贴板历史可以接受。
      await DB.raw("PRAGMA synchronous = NORMAL;");
      log.info("设置数据库模式为WAL + synchronous=NORMAL，提高性能");
    } catch (pragmaErr) {
      log.warn("设置数据库模式失败，继续使用默认模式:", pragmaErr);
    }

    // 以更健壮的方式创建表
    await ensureTable(DB, "note", createNotesTable);
    await ensureTable(DB, "settings", createSettingsTable);
    await ensureTable(DB, "document", createDocumentsTable);
    await ensureTable(DB, "template", createTemplatesTable);
    await ensureTable(DB, "ai_chat", createAiChatTable);
    await ensureTable(DB, "ai_chat_session", createAiChatSessionsTable);
    await ensureTable(DB, "ai_chat_summary", createAiChatSummaryTable);
    await ensureTable(DB, "ai_usage_log", createAiUsageLogTable);
    await addAiChatSessionIdColumn(DB);

    // AI 回复的有序分块（思考/工具/输出，重启后还要按原顺序渲染）
    await addAiChatBlocksColumn(DB);

    // 用户消息带的图片附件（多模态对话）
    await addAiChatImagesColumn(DB);

    // 一次性回填会话预览（历史数据里的 preview 存的是助手回复）
    await backfillAiSessionPreviews(DB);

    // 创建Todo表
    await ensureTable(DB, "todo", createTodosTable);

    // 检查并添加 todo 表的 attachments 字段（兼容旧版本数据库）
    await addTodoAttachmentsColumn(DB);

    // 检查并添加note表的is_pinned_to_ai字段
    await addNoteTableColumns(DB);

    // 补content_hash并建索引（剪贴板去重和列表排序都依赖它）
    await addNotePerformanceIndexes(DB);

    // 创建向量存储表
    await ensureTable(DB, "vector_store", createVectorStoreTable);

    // 创建记忆存储表
    await ensureTable(DB, "memory_store", createMemoryStoreTable);

    // 创建题单相关表
    await ensureTable(DB, "leetcode_collection", createLeetcodeCollectionTable);
    await ensureTable(DB, "leetcode_problem", createLeetcodeProblemTable);

    // 浏览器书签表
    await ensureTable(DB, "browser_bookmark", createBookmarksTable);

    // 主页快捷方式表
    await ensureTable(DB, "shortcut", createShortcutTable);

    // 检查并添加leetcode_problem表的title字段
    await addLeetcodeProblemTitleColumn(DB);

    // 检查并添加leetcode_problem表的difficulty字段
    await addLeetcodeProblemDifficultyColumn(DB);

    log.info("数据库迁移成功完成");
  } catch (err) {
    log.info("数据库迁移过程中发生错误:", err);
    // 继续执行而不抛出错误，让应用程序可以继续运行
  }
}

