import { ipcMain, IpcMainInvokeEvent, dialog } from "electron";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getMainWindow } from "../core/window/mainWindow";
import { DEFAULT_AI_CHAT_SESSION_ID } from "../../shared/constants/aiChat";
import { buildSessionPreview } from "../../shared/aiSessionPreview";
import { aiService, AiMessage } from "../utils/aiService";
import { configManager } from "../utils/config";
import { vectorStore } from "../utils/vectorStore";
import { log } from "../utils/log";
import { BlockBuilder, parseBlocks, serializeBlocks, type AssistantBlock } from "../../shared/aiBlocks";
import {
  aiContentToText,
  aiImageContentBlocks,
  buildUserContent,
  normalizeAiImages,
  parseAiImages,
  serializeAiImages,
  type AiImageAttachment,
} from "../../shared/aiImages";
import {
  ChatPromptTemplate,
} from "@langchain/core/prompts";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  SYSTEM_BASE_PROMPT,
  MEMORY_RECALL_PROMPT,
  AGENT_SYSTEM_PROMPT,
  SystemBaseInput,
  MemoryRecallInput,
} from "../utils/ai/prompts";
import {
  createChatModel,
} from "../utils/ai/providers";
import {
  runChatStream,
} from "../utils/ai/streaming";
import {
  runAgent,
} from "../utils/ai/agents/runAgent";
import {
  setToolContext,
  getEnabledTools,
  composeMemoryBlock,
} from "../utils/ai/tools";
import { longTermMemory } from "../utils/ai/memory/longTermMemory";
import {
  KnexChatMessageHistory,
} from "../utils/ai/memory/chatHistory";
import {
  getHotState,
  composeHistory,
  appendToHotState,
  invalidateHotState,
} from "../utils/ai/memory/hotMemory";
import { compactIfNeeded } from "../utils/ai/memory/compactor";
import { initUsageRecorder, UsageStatsService } from "../utils/ai/observability";
import { ObservabilityCallback } from "../utils/ai/observability/observabilityCallback";
import {
  applySkill,
  SKILL_CATEGORY,
} from "../utils/ai/skills";
import { browserAutomation } from "../core/window/browserAutomation";
import type { FileWriter } from "../core/fileWriter";

/** 选图对话框用的扩展名 → MIME（只收 OpenAI/Anthropic 都认的那几种） */
const MIME_BY_IMAGE_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** 从文本提取词语和字符二元片段，供记忆摘要统计关键词。 */
function extractDigestKeywords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const lexicalTokens = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  const compact = normalized.replace(/[^\p{L}\p{N}]+/gu, "");
  const grams = new Set<string>();

  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    if (gram.length === 2) {
      grams.add(gram);
    }
    if (grams.size >= 18) {
      break;
    }
  }

  return [...lexicalTokens, ...grams];
}

/** 汇总相关记忆中的关键词、内容类型和平均相关度，生成提示词摘要。 */
function buildMemoryDigest(notes: Array<{ content?: string; type?: string; ocr_result?: string; distance?: number }>): string {
  if (notes.length === 0) {
    return "";
  }

  const keywordCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const similarities: number[] = [];

  for (const note of notes) {
    const content = note.type === "image" && note.ocr_result ? note.ocr_result : note.content || "";
    for (const token of extractDigestKeywords(content)) {
      keywordCounts.set(token, (keywordCounts.get(token) || 0) + 1);
    }

    const noteType = note.type || "text";
    typeCounts.set(noteType, (typeCounts.get(noteType) || 0) + 1);

    if (typeof note.distance === "number") {
      similarities.push(1 - note.distance);
    }
  }

  const topKeywords = [...keywordCounts.entries()]
    // 排除单字符关键词。
    .filter(([keyword]) => keyword.length >= 2)
    // 按出现频次从高到低排列。
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    // 提取关键词文本。
    .map(([keyword]) => keyword);

  const typeSummary = [...typeCounts.entries()]
    // 按出现次数排列内容类型。
    .sort((left, right) => right[1] - left[1])
    // 将内容类型及数量格式化为摘要文本。
    .map(([type, count]) => `${type} ${count} 条`)
    .join("，");

  const averageSimilarity =
    similarities.length > 0
      ? similarities.reduce(
          // 累加相似度分值以计算平均值。
          (sum, value) => sum + value,
          0
        ) / similarities.length
      : 0;

  return [
    `命中记忆 ${notes.length} 条。`,
    topKeywords.length > 0 ? `高频主题词：${topKeywords.join("、")}。` : "",
    typeSummary ? `内容类型分布：${typeSummary}。` : "",
    similarities.length > 0 ? `平均相关度：${averageSimilarity.toFixed(2)}。` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * 共享 helper：根据用户消息 + 历史 + 记忆检索，拼装要发给 LLM 的完整 messages 数组。
 * send-ai-message 和 send-ai-message-stream 都走这条路径，避免两边重复实现。
 */
async function buildMessages(
  DB: any,
  message: string,
  chatSessionId: string,
  model?: BaseChatModel,
  onCompacting?: (p: { phase: string; round?: number; maxRounds?: number }) => void
): Promise<AiMessage[]> {
  // 按需压缩（传了 model 才做，否则只读缓存）
  // onProgress 驱动 UI 的「正在压缩」提示 —— 压缩要额外调一次 LLM，
  // 不给反馈的话用户只会看到界面卡住
  if (model) {
    try {
      await compactIfNeeded(DB, chatSessionId, model, (p) =>
        onCompacting?.({ phase: p.phase, round: p.round, maxRounds: p.maxRounds })
      );
    } catch (err) {
      log.warn("压缩失败，跳过:", err);
    }
  }

  // 热内存（摘要 + 未压缩消息）
  const hotState = await getHotState(DB, chatSessionId);
  const lcHistory = composeHistory(hotState);
  // LangChain 的 MessageType 是 "ai" / "human" / "system"（注意不是 "assistant"）
  const history = lcHistory.map((m) => ({
    role: m.getType() === "ai" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : "",
  }));

  // 使用本地记忆检索找到相关的历史内容
  let relevantNotes: any[] = [];
  try {
    const memorySearchResult = await vectorStore.searchSimilar(message, 5);
    if (memorySearchResult.success && memorySearchResult.results) {
      relevantNotes = memorySearchResult.results;
      log.info(`记忆检索找到 ${relevantNotes.length} 个相关内容`);
    }
  } catch (vectorError) {
    log.warn("记忆检索失败:", vectorError);
  }

  let promptTemplate: ChatPromptTemplate;
  let promptInput: SystemBaseInput | MemoryRecallInput;

  if (relevantNotes.length > 0) {
    const memoryDigest = buildMemoryDigest(relevantNotes);
    const relatedNotesText = relevantNotes
      // 将每条相关记忆格式化为提示词片段，并附上可用的相关度。
      .map((note: any, index: number) => {
        const content = note.type === "image" && note.ocr_result ? note.ocr_result : note.content;
        const similarity = note.distance ? `(相关度: ${(1 - note.distance).toFixed(2)})` : '';
        return `【相关内容 ${index + 1}】${similarity}\n${content}\n`;
      })
      .join('\n');

    promptTemplate = MEMORY_RECALL_PROMPT;
    promptInput = {
      memoryDigest,
      relatedNotes: relatedNotesText,
      history,
      question: message,
    };
  } else {
    promptTemplate = SYSTEM_BASE_PROMPT;
    promptInput = { history, question: message };
  }

  const lcMessages = await promptTemplate.formatMessages(promptInput as any);
  // 将 LangChain 消息转换为 AI 服务接受的纯文本消息结构。
  const messages: AiMessage[] = lcMessages.map((m: BaseMessage) => {
    // 我们只用纯文本 content；多模态不在本阶段覆盖
    const text = typeof m.content === "string" ? m.content : "";
    if (m.getType() === "system") return { role: "system", content: text };
    if (m.getType() === "ai") return { role: "assistant", content: text };
    return { role: "user", content: text };
  });

  // AI 长期记忆 —— 作为独立的 system 段插在最后一条 system 之后。
  // 刻意不改 prompt 模板：那三个模板里塞可变内容会让模板职责变糊，
  // 而且 recall 失败也不该影响主流程。放在这里，注入点是单一的。
  const memoryBlock = composeMemoryBlock(longTermMemory.recall(message));
  if (memoryBlock) {
    const lastSystem = messages.findIndex((m) => m.role === "system");
    messages.splice(lastSystem + 1, 0, { role: "system", content: memoryBlock });
  }

  return messages;
}

async function ensureAiChatSession(DB: any, id: string, title = "AI 助手"): Promise<void> {
  const existingSession = await DB.from("ai_chat_session").where({ id }).first("id");
  if (existingSession) return;

  const now = new Date();
  await DB.from("ai_chat_session").insert({
    id,
    title,
    preview: "",
    created_at: now,
    updated_at: now,
  });
}

/**
 * 一次「撞上限、等用户决定」的对话
 *
 * messages / accumulatedText / blocks 在续跑之间累积 —— 每次 continue 都在
 * 同一个 record 上追加，所以连点几次继续不会丢前几轮的正文和工具记录。
 */
interface ContinuationRecord {
  chatSessionId: string;
  /**
   * 用户原话。必须单独存：从 stash 的 BaseMessage[] 里找「最后一条 HumanMessage」
   * 是不行的 —— skill 消息和催场用的 SystemMessage 都会插在后面。
   */
  userMessage: string;
  messages: BaseMessage[];
  accumulatedText: string;
  blocks: AssistantBlock[];
  /** 已落库那两行的 id；续跑时改成 UPDATE 它们 */
  rowIds: number[];
  /** 累计跑了几轮，用于把总成本显示给用户 */
  totalRounds: number;
  maxIterations: number;
}

/**
 * 写入一轮对话（user + assistant），返回插入的两行 id。
 *
 * rowIds 返回给续跑流程：撞轮次上限时会先落库再问用户「是否继续」，
 * 继续时拿 rowIds 改成 UPDATE，而不是再插一对新行 —— 否则一次用户输入
 * 会在 ai_chat 里留下多组重复的 user/assistant。
 *
 * images 是这一轮用户带上的图片：落进 user 行的 images 列，
 * 同时进热内存 —— 后者决定模型这一轮能不能看见图。
 */
async function persistAiChatExchange(
  DB: any,
  chatSessionId: string,
  userMessage: string,
  assistantMessage: string,
  blocks?: AssistantBlock[],
  images?: AiImageAttachment[]
): Promise<{ rowIds: number[] }> {
  const createdAt = new Date();
  // 只发图没发字时，标题和预览不能是空的 —— 会话列表里会显示成一片空白，
  // 分不清是「没内容」还是「有图但显示不出来」。
  const titleSource =
    userMessage.trim() || (images && images.length > 0 ? "[图片]" : "");
  const title = titleSource.replace(/\s+/g, " ").trim().slice(0, 48) || "新建对话";
  // 预览取**用户**输入而非助手回复：助手回复又长又带推理过程，
  // 塞进会话列表既看不出聊了什么，还占满整块空间。
  const preview = buildSessionPreview(titleSource);

  // 拿回自增 id（用于同步热内存，压缩时需要 id 范围来安全删除）
  let inserted: Array<{ id: number }> = [];

  await DB.transaction(async (transaction: any) => {
    const session = await transaction("ai_chat_session")
      .where({ id: chatSessionId })
      .first("title");
    if (!session) throw new Error(`AI聊天会话不存在: ${chatSessionId}`);

    inserted = await transaction("ai_chat")
      .insert([
        {
          session_id: chatSessionId,
          role: "user",
          content: userMessage,
          images: serializeAiImages(images ?? []),
          created_at: createdAt,
        },
        {
          session_id: chatSessionId,
          role: "assistant",
          content: assistantMessage,
          blocks: serializeBlocks(blocks),
          created_at: createdAt,
        },
      ])
      .returning("id");

    await transaction("ai_chat_session")
      .where({ id: chatSessionId })
      .update({
        title: session.title === "新建对话" ? title : session.title,
        preview,
        updated_at: createdAt,
      });
  });

  const rowIds = inserted.map((r) => Number(r.id));

  // 同步热内存（避免下一轮又去查 DB）
  // 拿不到 id 时 appendToHotState 会填 -1，压缩时自动重建缓存兜底
  //
  // 带图时必须存成带块的 HumanMessage：只存文本的话，
  // 这一轮的图在后续轮次里就「消失」了 —— 模型以为用户没给过图。
  const userContent = buildUserContent(userMessage, images ?? []);
  appendToHotState(
    chatSessionId,
    [
      typeof userContent === 'string'
        ? new HumanMessage(userContent)
        : new HumanMessage({ content: userContent as any }),
      new AIMessage(assistantMessage),
    ],
    rowIds
  );

  return { rowIds };
}

/**
 * 续跑时把已有那两行改成最新内容（而不是再插一对）。
 *
 * 撞上限时已经落过一次库了，继续跑完只 UPDATE —— 这是「一次用户输入只留
 * 一组 user/assistant」的唯一保证。
 */
async function updatePersistedExchange(
  DB: any,
  chatSessionId: string,
  rowIds: number[],
  userMessage: string,
  assistantMessage: string,
  blocks?: AssistantBlock[]
): Promise<void> {
  const [userRowId, assistantRowId] = rowIds;
  if (!userRowId || !assistantRowId) return;
  await DB.from("ai_chat").where("id", userRowId).update({ content: userMessage });
  await DB.from("ai_chat").where("id", assistantRowId).update({
    content: assistantMessage,
    blocks: serializeBlocks(blocks),
  });
  await DB.from("ai_chat_session").where({ id: chatSessionId }).update({ updated_at: new Date() });
}

/**
 * 构建 skill 相关的消息
 *
 * 流程：
 *   1. 按 id 查 skill（category='skill'）
 *   2. 取剪贴板最新一条文本内容（供 {clipboard} 占位符使用）
 *   3. 调 applySkill 得到最终消息序列
 *
 * 任何一步失败都返回 null（不注入 skill），保证主链路不受影响。
 */
async function buildSkillMessages(
  DB: any,
  skillId: string,
  userInput: string
): Promise<Array<{ role: "system" | "user"; content: string }> | null> {
  try {
    const skill = await DB.from("template")
      .select("id", "name", "content")
      .where("id", skillId)
      .where("category", SKILL_CATEGORY)
      .first();

    if (!skill) {
      log.warn(`[skill] 找不到技能 ${skillId}`);
      return null;
    }

    // 取剪贴板最新一条文本内容（仅在 skill 含 {clipboard} 时才查）
    let clipboardContent: string | undefined;
    if (skill.content?.includes("{clipboard}")) {
      const latest = await DB.from("note")
        .select("content", "type", "ocr_result")
        .orderBy("created_at", "desc")
        .limit(1)
        .first();
      if (latest) {
        clipboardContent =
          latest.type === "image" && latest.ocr_result
            ? latest.ocr_result
            : latest.content;
      }
    }

    const result = applySkill({
      skillContent: skill.content,
      userInput,
      clipboardContent,
    });

    if (result.missingPlaceholders.length > 0) {
      log.warn(
        `[skill] 技能「${skill.name}」缺少占位符的值: ${result.missingPlaceholders.join(", ")}`
      );
    }

    log.info(
      `[skill] 应用技能「${skill.name}」mode=${result.mode} messages=${result.messages.length}`
    );

    return result.messages;
  } catch (err) {
    log.error("[skill] 构建技能消息失败，回退到普通对话:", err);
    return null;
  }
}

/**
 * 把图片接到一条已有的 user 消息上
 *
 * 用的场景是 skill：skill 会把用户原话换掉，但图片是用户这次真的带过来的，
 * 不能因为套了模板就丢在门外。图片排在文字前面（与 buildUserContent 一致）。
 */
function attachImagesToHumanMessage(
  message: BaseMessage,
  images: AiImageAttachment[]
): BaseMessage {
  if (images.length === 0) return message;
  const text = aiContentToText(message.content);
  const blocks: any[] = [...aiImageContentBlocks(images)];
  if (text) blocks.push({ type: "text", text });
  return new HumanMessage({ content: blocks });
}

/**
 * 注册 AI 消息、聊天历史和 AI 配置相关的 IPC 处理函数。
 *
 * @param fileWriter 笔记目录访问器 — 注入工具上下文供 save_note 使用。
 *                   做成必传而非可选：AI 存笔记是这个 handler 的核心能力之一，
 *                   漏传会表现为「工具在，但调用就报未初始化」，很难从现象反推。
 */
export function registerAiHandlers(DB: any, fileWriter: FileWriter) {
  // 流式会话注册表。sessionId → AbortController。
  // 当窗口销毁 / 用户取消时，主动 abort 中断 in-flight HTTP 请求。
  const activeStreams = new Map<string, AbortController>();

  /**
   * 待续跑的对话 —— agent 循环撞上 maxIterations 时存这里，等用户点「继续」
   *
   * 键是**客户端** sessionId（渲染层拿得回去的那个），不是 chatSessionId。
   *
   * 关键设计：撞上限时**已经先把这一轮落库了**，续跑走 UPDATE 而不是再插一对。
   * 这样有两层好处 —— 模块级 Map 随进程消失时，用户的这一轮对话还在库里；
   * 而且「一次用户输入只有一组 user/assistant」在结构上就不可能写重复。
   */
  const continuations = new Map<string, ContinuationRecord>();

  // 把 DB 注入工具上下文 — 工具实现通过 getToolContext() 拿到 DB
  // 同时注入内嵌浏览器句柄，供 browser_* 工具操控用户当前正在看的页面；
  // 以及 fileWriter，供 save_note 解析用户设置的笔记根目录。
  // setToolContext 是增量合并，后续每次 Agent 请求只需补 aiConfig。
  setToolContext({ DB, browser: browserAutomation, notes: fileWriter });

  // 初始化用量记录器（token / 延迟 / 错误分类）
  initUsageRecorder(DB);
  const usageStatsService = new UsageStatsService(DB);

  // 处理用户消息，检索相关记忆、调用模型并保存对话记录。
  ipcMain.handle("send-ai-message", async (event: IpcMainInvokeEvent, message: string, chatSessionId?: string) => {
    try {
      const activeChatSessionId = chatSessionId || DEFAULT_AI_CHAT_SESSION_ID;
      await ensureAiChatSession(DB, activeChatSessionId);
      const aiConfig = await configManager.getAiConfig();

      if (!aiConfig.apiKey) {
        throw new Error("请先在设置中配置AI API Key");
      }

      // 建 model（压缩需要复用它）+ 组装 messages + 调用
      const modelForCompact = createChatModel({
        provider: aiConfig.provider as any,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        baseUrl: aiConfig.baseUrl,
      });

      const messages = await buildMessages(
        DB,
        message,
        activeChatSessionId,
        modelForCompact,
        // 压缩期间通知 UI，否则用户只看到界面不动
        (p) => event.sender.send("ai-stream:compacting", { sessionId: activeChatSessionId, ...p })
      );
      const response = await aiService.sendMessage(
        messages,
        {
          provider: aiConfig.provider as any,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          baseUrl: aiConfig.baseUrl
        },
        undefined,
        // 可观测性 callback
        [
          new ObservabilityCallback({
            provider: aiConfig.provider,
            defaultModel: aiConfig.model,
            sessionId: activeChatSessionId,
          }),
        ]
      );

      // 保存对话到数据库
      await persistAiChatExchange(DB, activeChatSessionId, message, response.content);

      return {
        success: true,
        content: response.content,
        usage: response.usage
      };
    } catch (error) {
      log.error("AI消息发送失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ============================================================
  // 流式输出 IPC
  // ============================================================
  //
  // 协议：
  //   渲染进程：ipcRenderer.invoke("send-ai-message-stream", message, sessionId?)
  //     → 立即返回 { sessionId }（不阻塞）
  //   主进程：边收 chunk 边 webContents.send("ai-stream:chunk", { sessionId, delta })
  //   主进程：结束   webContents.send("ai-stream:end",   { sessionId, content })
  //   主进程：错误   webContents.send("ai-stream:error", { sessionId, error })
  //   渲染进程：ipcRenderer.send("cancel-ai-message", sessionId) — 中途中止
  //
  // 兼容性：保留旧 send-ai-message 不变；本次默认行为走流式，老调用方零感知。
  // ============================================================

  ipcMain.handle(
    "send-ai-message-stream",
    async (event: IpcMainInvokeEvent, message: string, clientSessionId?: string, chatSessionId?: string) => {
      const sessionId = clientSessionId || randomUUID();
      const activeChatSessionId = chatSessionId || DEFAULT_AI_CHAT_SESSION_ID;
      const controller = new AbortController();
      activeStreams.set(sessionId, controller);

      // 异步推送：不阻塞 invoke 返回，让渲染进程能立即拿到 sessionId 开始准备 UI
      // 后台任务"发起即忘"：内部已有 try/catch/finally 兜住主流程，
      // 这里再补一层 .catch —— 万一 catch/finally 自身抛错（比如 renderer 已销毁时
      // sender.send 抛错），也不会变成"未处理的Promise拒绝"。
      void (async () => {
        try {
          await ensureAiChatSession(DB, activeChatSessionId);
          const aiConfig = await configManager.getAiConfig();
          if (!aiConfig.apiKey) {
            event.sender.send("ai-stream:error", {
              sessionId,
              error: "请先在设置中配置AI API Key",
            });
            return;
          }

          // 用 createChatModel + runChatStream 走 LangChain 流式路径
          // （先建 model —— buildMessages 的压缩逻辑需要复用它）
          const model = createChatModel({
            provider: aiConfig.provider as any,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
            baseUrl: aiConfig.baseUrl,
          });

          const messages = await buildMessages(
            DB,
            message,
            activeChatSessionId,
            model,
            // 压缩期间通知 UI
            (p) => event.sender.send("ai-stream:compacting", { sessionId, ...p })
          );

          const sender = event.sender;
          let content = "";
          try {
            const streamResult = await runChatStream({
              model,
              messages, // runChatStream 内部不区分 BaseMessage / AiMessage
              signal: controller.signal,
              // 可观测性 callback（自动采集 token / 延迟 / 错误）
              callbacks: [
                new ObservabilityCallback({
                  provider: aiConfig.provider,
                  defaultModel: aiConfig.model,
                  sessionId: activeChatSessionId,
                }),
              ],
              onChunk: (delta) => {
                content += delta;
                sender.send("ai-stream:chunk", { sessionId, delta });
              },
            });
            // 流完成后再赋一次 content（兜底：onChunk 没累积完整的情况）
            content = streamResult.content || content;
          } catch (streamErr) {
            const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
            // AbortError 不算错误 — 用户主动取消
            if (controller.signal.aborted) {
              log.info(`[ai-stream] session ${sessionId} aborted by user`);
              sender.send("ai-stream:end", { sessionId, content });
            } else {
              log.error(`[ai-stream] session ${sessionId} failed:`, streamErr);
              sender.send("ai-stream:error", { sessionId, error: errMsg });
            }
            return;
          }

          if (controller.signal.aborted) {
            sender.send("ai-stream:end", { sessionId, content });
            return;
          }

          // 持久化到数据库（与 send-ai-message 行为一致）
          try {
            await persistAiChatExchange(DB, activeChatSessionId, message, content);
          } catch (dbErr) {
            log.error(`[ai-stream] session ${sessionId} persist failed:`, dbErr);
            // DB 写入失败不影响已流式推送给用户的内容
          }

          // 持久化完成后再通知渲染进程，以便会话列表立即读到最新摘要。
          sender.send("ai-stream:end", { sessionId, content });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error(`[ai-stream] session ${sessionId} outer error:`, err);
          if (!controller.signal.aborted) {
            event.sender.send("ai-stream:error", { sessionId, error: errMsg });
          }
        } finally {
          activeStreams.delete(sessionId);
        }
      })().catch((err) => {
        log.error(`[ai-stream] session ${sessionId} 未被内部捕获的异常:`, err);
      });

      return { sessionId };
    }
  );

  // 中途取消某个 session 的流
  ipcMain.on("cancel-ai-message", (_event: IpcMainInvokeEvent, sessionId: string) => {
    const controller = activeStreams.get(sessionId);
    if (controller) {
      log.info(`[ai-stream] cancel session ${sessionId}`);
      controller.abort();
    }
    // 待续跑的记录也一起清掉：撞上限时那个 IIFE 已经返回、activeStreams 里
    // 早就没这个 session 了，光靠 abort 清不掉 —— Map 里会留着一份完整的
    // 消息历史（含每次工具返回的正文）一直没人回收。
    if (continuations.delete(sessionId)) {
      log.info(`[ai-agent] 丢弃待续跑记录 ${sessionId}`);
    }
  });

  // ============================================================
  // Agent 模式（工具调用）— 流式
  // ============================================================
  //
  // 协议：
  //   renderer → main: invoke("send-ai-agent-stream", message, sessionId?)
  //   main → renderer: send("ai-stream:chunk",   { sessionId, delta })
  //   main → renderer: send("ai-stream:tool-call",  { sessionId, name, args, id })
  //   main → renderer: send("ai-stream:tool-result", { sessionId, name, result, isError, id })
  //   main → renderer: send("ai-stream:end",     { sessionId, content })
  //   main → renderer: send("ai-stream:error",   { sessionId, error })
  // ============================================================

  ipcMain.handle(
    "send-ai-agent-stream",
    async (
      event: IpcMainInvokeEvent,
      message: string,
      clientSessionId?: string,
      chatSessionId?: string,
      /** Skill 技能 id（可选，null/空 = 不使用技能） */
      skillId?: string | null,
      /**
       * 本轮带的图片附件（可选）
       *
       * 渲染层已经缩过尺寸，这里再做一遍校验 —— IPC 通道是外部输入，
       * 不能假设传进来的都是合法的图片。
       */
      images?: AiImageAttachment[]
    ) => {
      const sessionId = clientSessionId || randomUUID();
      const activeChatSessionId = chatSessionId || DEFAULT_AI_CHAT_SESSION_ID;
      const controller = new AbortController();
      activeStreams.set(sessionId, controller);

      // 同一会话上如果还挂着「等用户决定」的旧记录，这次新提问已经把它作废了。
      // 不清的话那份 Map 会一直留着消息历史，而且用户再也点不到它的「继续」按钮。
      for (const [sid, rec] of continuations) {
        if (rec.chatSessionId === activeChatSessionId) {
          continuations.delete(sid);
          log.info(`[ai-agent] 新提问作废了待续跑记录 ${sid}`);
        }
      }

      // 后台任务"发起即忘"：内部已有 try/catch/finally 兜住主流程，
      // 这里再补一层 .catch —— 万一 catch/finally 自身抛错（比如 renderer 已销毁时
      // sender.send 抛错），也不会变成"未处理的Promise拒绝"。
      void (async () => {
        try {
          if (chatSessionId) {
            const existingSession = await DB.from("ai_chat_session")
              .where({ id: activeChatSessionId })
              .first("id");
            if (!existingSession) {
              event.sender.send("ai-stream:error", {
                sessionId,
                error: "此对话已不存在或已删除",
              });
              return;
            }
          } else {
            await ensureAiChatSession(DB, activeChatSessionId);
          }
          const aiConfig = await configManager.getAiConfig();
          if (!aiConfig.apiKey) {
            event.sender.send("ai-stream:error", {
              sessionId,
              error: "请先在设置中配置AI API Key",
            });
            return;
          }

          // 工具全部默认启用
          const tools = getEnabledTools();
          log.info(`[ai-agent] session ${sessionId} tools=${tools.map(t => t.name).join(",")}`);

          // 用 LangChain model 加载；如支持工具调用则 .bindTools(tools)
          const model = createChatModel({
            provider: aiConfig.provider as any,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
            baseUrl: aiConfig.baseUrl,
          });
          const modelWithTools =
            typeof (model as any).bindTools === "function"
              ? (model as any).bindTools(tools)
              : model;

          // 构造 system + user prompt
          // 注入 tool 上下文让 get_app_info 工具能拿到 aiConfig
          setToolContext({ DB, aiConfig });

          // 必须在压缩之前取：下面 compactIfNeeded 的进度回调是**同步**调用的
          // （compactor.ts 内部直接 onProgress?.()），而原来这行 const sender 声明在
          // 54 行之后。TDZ 下引用它会抛 ReferenceError，被下面的 catch 吞成
          // 「compact failed」—— 结果是 agent 模式下压缩从未真正执行过，
          // compressed=1 永不写入，热内存无上限增长。
          const sender = event.sender;

          // 按需压缩会话历史（超阈值时调 LLM摘要 + 清理老消息）
          // 传 model 而不是 modelWithTools：压缩只需模型能"总结一段话"，
          // 给绑了 13 个工具的模型会把全部工具 schema 塞进压缩请求，
          // 既拖慢又可能干扰摘要输出。
          try {
            const compactResult = await compactIfNeeded(
              DB,
              activeChatSessionId,
              model,
              (p) => sender.send("ai-stream:compacting", { sessionId, ...p })
            );
            if (compactResult.compressed) {
              log.info(`[ai-agent] session ${sessionId} compacted`, compactResult);
            }
          } catch (compactErr) {
            // 压缩失败不影响主流程
            log.error(`[ai-agent] compact failed, continue without compaction:`, compactErr);
          }

          // 热内存（摘要 + 未压缩消息）替代「取最近 20 条」
          const hotState = await getHotState(DB, activeChatSessionId);
          const chatHistory: BaseMessage[] = composeHistory(hotState);

          const baseSystemMessage = await AGENT_SYSTEM_PROMPT.formatMessages({
            history: [],
            question: "",
          }).then((msgs) => msgs[0]);

          // AI 长期记忆 —— Agent 模式同样要带上，否则它会忘掉用户交代的约定。
          // 作为独立的 system 段插在基础 system 之后，历史消息之前。
          const memoryBlock = composeMemoryBlock(longTermMemory.recall(message));
          const memoryMessage: BaseMessage[] = memoryBlock
            ? [new SystemMessage(memoryBlock)]
            : [];

          // Skill 技能：把 skill 应用到本次提问上
          const skillMessages = skillId
            ? await buildSkillMessages(DB, skillId, message)
            : null;

          // 本轮带的图片（先过一遍校验，非法的那张直接丢掉）
          const attachedImages = normalizeAiImages(images);
          if (attachedImages.length > 0) {
            log.info(
              `[ai-agent] session ${sessionId} 收到 ${attachedImages.length} 张图片`
            );
          }

          let lcMessages: BaseMessage[];
          if (skillMessages && skillMessages.length > 0) {
            const skillLc: BaseMessage[] = skillMessages.map((m) =>
              m.role === "system"
                ? new SystemMessage(m.content)
                : new HumanMessage(m.content)
            );
            // skill 会把用户原话换掉，但图片是用户这次真的带过来的 ——
            // 接到最后一条 user 消息上，不能因为用了 skill 就丢掉
            if (attachedImages.length > 0) {
              let lastUserIndex = -1;
              for (let i = skillLc.length - 1; i >= 0; i -= 1) {
                if (skillLc[i].getType() === "human") {
                  lastUserIndex = i;
                  break;
                }
              }
              if (lastUserIndex >= 0) {
                skillLc[lastUserIndex] = attachImagesToHumanMessage(
                  skillLc[lastUserIndex],
                  attachedImages
                );
              }
            }
            lcMessages = [
              baseSystemMessage,
              ...memoryMessage,
              ...chatHistory,
              ...skillLc,
            ];
          } else {
            const userContent = buildUserContent(message, attachedImages);
            lcMessages = [
              baseSystemMessage,
              ...memoryMessage,
              ...chatHistory,
              typeof userContent === "string"
                ? new HumanMessage(userContent)
                : new HumanMessage({ content: userContent as any }),
            ];
          }

          let accumulatedText = "";
          // 思考/工具/输出的有序构建器 —— 与落库内容同源
          const blockBuilder = new BlockBuilder();

          const result = await runAgent({
            model: modelWithTools,
            messages: lcMessages,
            tools,
            signal: controller.signal,
            maxIterations: 6,
            // 可观测性 callback
            // 用工厂而非实例 —— runAgent 每轮迭代都要拿到独立 handler，
            // 否则所有轮次的 timings 会串在一个 Map 里
            callbacksFactory: (agentIteration: number) => [
              new ObservabilityCallback({
                provider: aiConfig.provider,
                defaultModel: aiConfig.model,
                sessionId: activeChatSessionId,
                agentIteration,
              }),
            ],
            onEvent: (ev) => {
              // 三类事件喂进同一个构建器，产出「思考/工具/输出」的有序序列。
              // 构建器只在这条流上跑一遍，落库和渲染拿的是同一份顺序。
              if (ev.type === "text") {
                if (ev.text && !controller.signal.aborted) {
                  accumulatedText += ev.text;
                  blockBuilder.pushText(ev.text);
                  sender.send("ai-stream:chunk", { sessionId, delta: ev.text });
                }
              } else if (ev.type === "tool_call") {
                blockBuilder.pushToolCall({
                  id: ev.toolCall!.id,
                  name: ev.toolCall!.name,
                  args: ev.toolCall!.args,
                });
                sender.send("ai-stream:tool-call", {
                  sessionId,
                  id: ev.toolCall!.id,
                  name: ev.toolCall!.name,
                  args: ev.toolCall!.args,
                });
              } else if (ev.type === "tool_result") {
                blockBuilder.pushToolResult(
                  ev.toolResult!.id,
                  ev.toolResult!.content,
                  ev.toolResult!.isError ?? false
                );
                sender.send("ai-stream:tool-result", {
                  sessionId,
                  id: ev.toolResult!.id,
                  name: ev.toolResult!.name,
                  result: ev.toolResult!.content,
                  isError: ev.toolResult!.isError ?? false,
                });
              }
            },
          });

          if (controller.signal.aborted) {
            sender.send("ai-stream:end", { sessionId, content: accumulatedText });
            continuations.delete(sessionId);
            return;
          }

          const blocks = blockBuilder.blocks();
          // 必须存 accumulatedText（整轮流式输出的完整拼接），不能存 result.content。
          // result.content 只是**最后一个无工具调用那一轮**的文本，中间每一轮的推理块全被丢掉 ——
          // 实测一轮对话模型输出了 46k token，库里只留下 12k，约 74% 蒸发。
          // MiniMax-M3 是 interleaved thinking，官方要求推理链完整保留在历史里，
          // 砍掉之后推理链在每个轮次边界都断，表现就是模型开始把工具调用写进推理文本里、
          // tool_call_chunks 变空，工具永远调不出来。
          // 结果全走工具调用、正文一个字没吐时才回落到 result.content。
          const finalText = accumulatedText || result.content;

          // 撞上轮次上限：先把已完成的部分落库（Map 会随进程消失，落库才扛得住重启），
          // 再问用户要不要继续。不发 end —— 渲染层的监听要留着等续跑那几轮。
          if (result.hitIterationLimit) {
            let rowIds: number[] = [];
            try {
              const persisted = await persistAiChatExchange(
                DB,
                activeChatSessionId,
                message,
                finalText,
                blocks,
                attachedImages
              );
              rowIds = persisted.rowIds;
            } catch (dbErr) {
              log.error(`[ai-agent] session ${sessionId} persist failed:`, dbErr);
            }

            continuations.set(sessionId, {
              chatSessionId: activeChatSessionId,
              userMessage: message,
              messages: result.messages,
              accumulatedText,
              blocks,
              rowIds,
              totalRounds: result.maxIterations,
              maxIterations: result.maxIterations,
            });
            log.info(
              `[ai-agent] session ${sessionId} 撞上轮次上限(${result.maxIterations})，已落库并等待用户决定`
            );
            sender.send("ai-stream:need_continue", {
              sessionId,
              rounds: result.maxIterations,
              totalRounds: result.maxIterations,
            });
            return;
          }

          // 正常收尾（仅 user + 最终 assistant — 不存中间 tool 回合，避免污染 ai_chat）
          // 有序分块记在 assistant 行的 blocks 列里，渲染层据此按 思考→工具→输出 还原
          try {
            await persistAiChatExchange(
              DB,
              activeChatSessionId,
              message,
              finalText,
              blocks,
              attachedImages
            );
          } catch (dbErr) {
            log.error(`[ai-agent] session ${sessionId} persist failed:`, dbErr);
          }
          continuations.delete(sessionId);

          sender.send("ai-stream:end", { sessionId, content: finalText });
        } catch (err) {
          if (!controller.signal.aborted) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`[ai-agent] session ${sessionId} failed:`, err);
            event.sender.send("ai-stream:error", { sessionId, error: errMsg });
          }
        } finally {
          activeStreams.delete(sessionId);
        }
      })().catch((err) => {
        log.error(`[ai-agent] session ${sessionId} 未被内部捕获的异常:`, err);
      });

      return { sessionId };
    }
  );

  /**
   * 用户对「是否继续」的回答
   *
   * 'continue' → 用 stash 里的累积 messages 再跑一轮（新的迭代预算），事件仍走
   *             同一个 sessionId，渲染层的监听不用重订
   * 'stop'     → 收尾，把已落库的内容原样发 end
   *
   * 两种都只 UPDATE 已落库的那两行，不再插新的 —— 否则一次用户输入会在
   * ai_chat 里留下多组重复的 user/assistant。
   */
  ipcMain.handle(
    "ai-continue-agent",
    async (_event, sessionId: string, decision: "continue" | "stop") => {
      const record = continuations.get(sessionId);
      if (!record) return { ok: false, error: "没有待续跑的对话" };
      const sender = _event.sender;

      if (decision === "stop") {
        continuations.delete(sessionId);
        if (!sender.isDestroyed()) {
          sender.send("ai-stream:end", {
            sessionId,
            content: record.accumulatedText,
          });
        }
        return { ok: true };
      }

      try {
        const aiConfig = await configManager.getAiConfig();
        const tools = getEnabledTools();
        setToolContext({ DB, aiConfig });
        const model = createChatModel({
          provider: aiConfig.provider as any,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          baseUrl: aiConfig.baseUrl,
        });
        const modelWithTools =
          typeof (model as any).bindTools === "function"
            ? (model as any).bindTools(tools)
            : model;

        const controller = new AbortController();
        activeStreams.set(sessionId, controller);

        let accumulatedText = record.accumulatedText;
        // 本次续跑新产生的块，最后拼在 record.blocks 后面。
        // 不把旧块回灌进构建器 —— 那会丢掉工具块已填好的 result/status。
        const blockBuilder = new BlockBuilder();
        const priorBlocks = [...record.blocks];

        const result = await runAgent({
          model: modelWithTools,
          messages: record.messages,
          tools,
          signal: controller.signal,
          maxIterations: record.maxIterations,
          callbacksFactory: (agentIteration: number) => [
            new ObservabilityCallback({
              provider: aiConfig.provider,
              defaultModel: aiConfig.model,
              sessionId: record.chatSessionId,
              agentIteration,
            }),
          ],
          onEvent: (ev) => {
            if (sender.isDestroyed()) return;
            if (ev.type === "text" && ev.text && !controller.signal.aborted) {
              accumulatedText += ev.text;
              sender.send("ai-stream:chunk", { sessionId, delta: ev.text });
            } else if (ev.type === "tool_call") {
              sender.send("ai-stream:tool-call", {
                sessionId,
                id: ev.toolCall!.id,
                name: ev.toolCall!.name,
                args: ev.toolCall!.args,
              });
            } else if (ev.type === "tool_result") {
              sender.send("ai-stream:tool-result", {
                sessionId,
                id: ev.toolResult!.id,
                name: ev.toolResult!.name,
                result: ev.toolResult!.content,
                isError: ev.toolResult!.isError ?? false,
              });
            }
          },
        });

        const totalRounds = record.totalRounds + record.maxIterations;
        // 同上：存完整拼接，不能只存最后一轮（推理链不能断）
        const finalText = accumulatedText || result.content;
        const blocks = [...priorBlocks, ...blockBuilder.blocks()];

        // 又撞上限 → 继续挂着等下一次决定
        if (result.hitIterationLimit) {
          record.messages = result.messages;
          record.accumulatedText = accumulatedText;
          record.blocks = blocks;
          record.totalRounds = totalRounds;
          await updatePersistedExchange(
            DB,
            record.chatSessionId,
            record.rowIds,
            record.userMessage,
            finalText,
            blocks
          ).catch((err) => log.error("续跑后更新落库失败:", err));
          if (!sender.isDestroyed()) {
            sender.send("ai-stream:need_continue", {
              sessionId,
              rounds: result.maxIterations,
              totalRounds,
            });
          }
          return { ok: true };
        }

        await updatePersistedExchange(
          DB,
          record.chatSessionId,
          record.rowIds,
          record.userMessage,
          finalText,
          blocks
        ).catch((err) => log.error("续跑后更新落库失败:", err));

        continuations.delete(sessionId);
        if (!sender.isDestroyed()) {
          sender.send("ai-stream:end", { sessionId, content: finalText });
        }
        return { ok: true };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`[ai-continue] session ${sessionId} failed:`, err);
        if (!sender.isDestroyed()) {
          sender.send("ai-stream:error", { sessionId, error: errMsg });
        }
        return { ok: false, error: errMsg };
      } finally {
        activeStreams.delete(sessionId);
      }
    }
  );

  // ============================================================
  // 选图对话框（AI 对话附件）
  // ============================================================

  /**
   * 打开系统文件选择框选图片，返回原始字节的 base64。
   *
   * ## 为什么不在这里缩图
   *
   * 缩图要用 canvas（渲染层才有），而这里只能拿到文件字节。
   * 原图过大时 base64 会撑到好几 MB —— 但这是一次性的用户动作，
   * 而且渲染层拿到后会立刻缩到 1568px 再发回来。
   *
   * ## 为什么不存进笔记资源目录
   *
   * notes:pick-image 会把图写进用户的笔记目录，那是用户的数据。
   * 对话附件是临时的，不该在用户的笔记里留下没头没尾的图片文件。
   */
  ipcMain.handle("ai:pick-images", async () => {
    const win = getMainWindow();
    if (!win) {
      log.error("ai:pick-images 调用时主窗口不存在，无法打开图片选择框");
      return [];
    }

    const result = await dialog.showOpenDialog(win, {
      title: "添加图片",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];

    const picked: AiImageAttachment[] = [];
    for (const filePath of result.filePaths) {
      try {
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_BY_IMAGE_EXT[ext];
        // 非图片 / 读不出来就跳过这一张，不影响其它几张
        if (!mime) continue;
        picked.push({
          mime,
          data: buffer.toString("base64"),
          name: path.basename(filePath),
        });
      } catch (err) {
        log.error(`读取图片失败 ${filePath}:`, err);
      }
    }
    return picked;
  });

  ipcMain.handle("get-ai-chat-sessions", async () => {
    try {
      const sessions = await DB.from("ai_chat_session")
        .select("id", "title", "preview", "created_at", "updated_at")
        .orderBy("updated_at", "desc")
        .orderBy("created_at", "desc");

      return sessions.map((session: any) => ({
        ...session,
        created_at: new Date(session.created_at),
        updated_at: new Date(session.updated_at),
      }));
    } catch (error) {
      log.error("获取AI会话列表失败", error);
      return [];
    }
  });

  ipcMain.handle("create-ai-chat-session", async () => {
    const now = new Date();
    const session = {
      id: randomUUID(),
      title: "新建对话",
      preview: "",
      created_at: now,
      updated_at: now,
    };

    await DB.from("ai_chat_session").insert(session);
    return session;
  });

  ipcMain.handle("get-ai-chat-session-history", async (_event, chatSessionId: string) => {
    try {
      // blocks 必须列出来：下面是显式列清单，漏一列就是 SQL 报错，
      // 而 catch 会把它吞成 return [] —— 表现为「整段聊天记录变空白且不报错」。
      // images 同理：漏了它，历史里的图片附件就再也回不到界面上。
      const history = await DB.from("ai_chat")
        .select("id", "role", "content", "blocks", "images", "created_at")
        .where("session_id", chatSessionId)
        .orderBy("created_at", "asc")
        .orderBy("id", "asc");

      return history.map((message: any) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        blocks: parseBlocks(message.blocks),
        images: parseAiImages(message.images),
        created_at: new Date(message.created_at),
      }));
    } catch (error) {
      log.error("获取AI会话历史失败", error);
      return [];
    }
  });

  ipcMain.handle("delete-ai-chat-session", async (_event, chatSessionId: string) => {
    if (typeof chatSessionId !== "string" || !chatSessionId.trim()) return false;

    // 删会话前清掉摘要和热缓存
    invalidateHotState(chatSessionId);
    try {
      await DB.from("ai_chat_summary").where("session_id", chatSessionId).delete();
    } catch (err) {
      log.warn(`清理会话摘要失败 ${chatSessionId}:`, err);
    }

    try {
      return await DB.transaction(async (transaction: any) => {
        await transaction("ai_chat").where("session_id", chatSessionId).delete();
        const deletedSessions = await transaction("ai_chat_session")
          .where({ id: chatSessionId })
          .delete();
        return deletedSessions > 0;
      });
    } catch (error) {
      log.error("删除AI会话失败", error);
      return false;
    }
  });

  // 返回默认剪贴板助手会话的历史，并转换数据库时间字段。
  ipcMain.handle("get-ai-chat-history", async () => {
    try {
      const history = await DB.from("ai_chat")
        .select("*")
        .where("session_id", DEFAULT_AI_CHAT_SESSION_ID)
        .orderBy("created_at", "desc")
        .limit(100);

      // 将数据库行转换为 renderer 使用的聊天记录对象。
      return history.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        blocks: parseBlocks(msg.blocks),
        images: parseAiImages(msg.images),
        created_at: new Date(msg.created_at)
      }));
    } catch (error) {
      log.error("获取AI对话历史失败", error);
      return [];
    }
  });

  // 清空默认剪贴板助手会话，不影响其他已归档对话。
  ipcMain.handle("clear-ai-chat", async () => {
    // 清缓存 + 摘要
    invalidateHotState(DEFAULT_AI_CHAT_SESSION_ID);
    try {
      await DB.from("ai_chat_summary").where("session_id", DEFAULT_AI_CHAT_SESSION_ID).delete();
    } catch (err) {
      log.warn("清理默认会话摘要失败:", err);
    }

    try {
      await DB.from("ai_chat").where("session_id", DEFAULT_AI_CHAT_SESSION_ID).delete();
      await DB.from("ai_chat_session")
        .where({ id: DEFAULT_AI_CHAT_SESSION_ID })
        .update({ preview: "", updated_at: new Date() });
      return true;
    } catch (error) {
      log.error("清空AI对话失败", error);
      return false;
    }
  });

  // 读取已保存的 AI 配置，并在读取失败时返回默认配置。
  // AI 用量统计（设置页可视化）
  ipcMain.handle("get-ai-usage-stats", async () => {
    return usageStatsService.getStats();
  });

  // 手动清空用量记录（设置页提供入口）
  ipcMain.handle("clear-ai-usage-log", async () => {
    try {
      const deleted = await DB("ai_usage_log").delete();
      log.info(`[usage] 已清空用量记录（${deleted} 条）`);
      return { success: true, deleted };
    } catch (err) {
      log.error("[usage] 清空用量记录失败:", err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("get-ai-config", async () => {
    try {
      // 必须 await：不 await 的话 promise 的 rejection 根本进不了 catch，
      // 这里的兜底配置等于没写
      return await configManager.getAiConfig();
    } catch (error) {
      log.error("获取AI配置失败", error);
      return { provider: 'deepseek', apiKey: '', model: '', baseUrl: '' };
    }
  });

  // 保存用户选择的 provider、API Key、模型和服务地址。
  ipcMain.handle("set-ai-config", async (event: IpcMainInvokeEvent, provider: string, apiKey: string, model: string, baseUrl: string) => {
    try {
      await configManager.setAiConfig(provider as any, apiKey, model, baseUrl);
      return true;
    } catch (error) {
      log.error("设置AI配置失败", error);
      return false;
    }
  });

  // 使用当前 AI 配置发送测试请求，返回 API Key 是否有效。
  ipcMain.handle("validate-ai-config", async (event: IpcMainInvokeEvent, provider: string, apiKey: string, model: string, baseUrl: string) => {
    try {
      const isValid = await aiService.validateApiKey({
        provider: provider as any,
        apiKey,
        model,
        baseUrl
      });
      return isValid;
    } catch (error) {
      log.error("验证AI配置失败", error);
      return false;
    }
  });
}

