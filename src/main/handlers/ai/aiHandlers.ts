import { ipcMain, IpcMainInvokeEvent, dialog } from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getMainWindow } from "../../core/window/mainWindow";
import { startAiActivity, setAiActivityTool, endAiActivity } from "../../core/ai/aiActivity";
import { DEFAULT_AI_CHAT_SESSION_ID } from "../../../shared/ai/constants/aiChat";
import { resolveAiChatSession } from "../../core/ai/chatSession";
import { buildSessionPreview } from "../../../shared/ai/aiSessionPreview";
import { aiService, AiMessage } from "../../core/ai/aiService";
import { configManager } from "../../core/system/config";
import { vectorStore } from "../../core/ai/vectorStore";
import { log } from "../../core/system/log";
import { BlockBuilder, parseBlocks, serializeBlocks, type AssistantBlock } from "../../../shared/ai/aiBlocks";
import {
  aiContentToText,
  aiImageContentBlocks,
  buildUserContent,
  normalizeAiImages,
  parseAiImages,
  serializeAiImages,
  type AiImageAttachment,
} from "../../../shared/ai/aiImages";
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
} from "../../core/ai/prompts/index";
import {
  createChatModel,
} from "../../core/ai/providers";
import {
  runAgent,
} from "../../core/ai/agents/runAgent";
import {
  getEnabledTools,
  composeMemoryBlock,
} from "../../core/ai/tools/index";
import { setToolContext } from "../../core/ai/toolContext";
import { longTermMemory } from "../../core/ai/memory/longTermMemory";
import {
} from "../../core/ai/memory/chatHistory";
import {
  getHotState,
  composeHistory,
  appendToHotState,
  invalidateHotState,
} from "../../core/ai/memory/hotMemory";
import { compactIfNeeded } from "../../core/ai/memory/compactor";
import { initUsageRecorder, UsageStatsService } from "../../core/ai/observability/index";
import { ObservabilityCallback } from "../../core/ai/observability/observabilityCallback";
import {
  applySkill,
  SKILL_CATEGORY,
} from "../../core/ai/skills/index";
import { browserAutomation } from "../../core/window/browser/browserAutomation";
import type { FileWriter } from "../../core/notes/fileWriter";

const MIME_BY_IMAGE_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

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
    .filter(([keyword]) => keyword.length >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([keyword]) => keyword);

  const typeSummary = [...typeCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `${type} ${count} 条`)
    .join("，");

  const averageSimilarity =
    similarities.length > 0
      ? similarities.reduce(
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 接线时用：send-ai-message 与 send-ai-message-stream 都走这条路径
async function buildMessages( // NOSONAR
  DB: any,
  message: string,
  chatSessionId: string,
  model?: BaseChatModel,
  onCompacting?: (p: { phase: string; round?: number; maxRounds?: number }) => void
): Promise<AiMessage[]> {
  if (model) {
    try {
      await compactIfNeeded(DB, chatSessionId, model, (p) =>
        onCompacting?.({ phase: p.phase, round: p.round, maxRounds: p.maxRounds })
      );
    } catch (err) {
      log.warn("压缩失败，跳过:", err);
    }
  }

  const hotState = await getHotState(DB, chatSessionId);
  const lcHistory = composeHistory(hotState);
  const history = lcHistory.map((m) => ({
    role: m.getType() === "ai" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : "",
  }));

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
  const messages: AiMessage[] = lcMessages.map((m: BaseMessage) => {
    const text = typeof m.content === "string" ? m.content : "";
    if (m.getType() === "system") return { role: "system", content: text };
    if (m.getType() === "ai") return { role: "assistant", content: text };
    return { role: "user", content: text };
  });

  const memoryBlock = composeMemoryBlock(longTermMemory.recall(message));
  if (memoryBlock) {
    const lastSystem = messages.findIndex((m) => m.role === "system");
    messages.splice(lastSystem + 1, 0, { role: "system", content: memoryBlock });
  }

  return messages;
}

interface ContinuationRecord {
  chatSessionId: string;
  userMessage: string;
  messages: BaseMessage[];
  accumulatedText: string;
  blocks: AssistantBlock[];
  rowIds: number[];
  totalRounds: number;
  maxIterations: number;
}

async function persistAiChatExchange(
  DB: any,
  chatSessionId: string,
  userMessage: string,
  assistantMessage: string,
  blocks?: AssistantBlock[],
  images?: AiImageAttachment[]
): Promise<{ rowIds: number[] }> {
  const createdAt = new Date();
  const titleSource =
    userMessage.trim() || (images && images.length > 0 ? "[图片]" : "");
  const title = titleSource.replace(/\s+/g, " ").trim().slice(0, 48) || "新建对话";
  const preview = buildSessionPreview(titleSource);

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

export function registerAiHandlers(DB: any, fileWriter: FileWriter) {
  const activeStreams = new Map<string, AbortController>();

  const continuations = new Map<string, ContinuationRecord>();

  setToolContext({ DB, browser: browserAutomation, notes: fileWriter });

  initUsageRecorder(DB);
  const usageStatsService = new UsageStatsService(DB);

  ipcMain.on("cancel-ai-message", (_event: IpcMainInvokeEvent, sessionId: string) => {
    const controller = activeStreams.get(sessionId);
    if (controller) {
      log.info(`[ai-stream] cancel session ${sessionId}`);
      controller.abort();
    }
    if (continuations.delete(sessionId)) {
      log.info(`[ai-agent] 丢弃待续跑记录 ${sessionId}`);
    }
  });


  ipcMain.handle(
    "send-ai-agent-stream",
    async (
      event: IpcMainInvokeEvent,
      message: string,
      clientSessionId?: string,
      chatSessionId?: string,
      skillId?: string | null,
      images?: AiImageAttachment[]
    ) => {
      const sessionId = clientSessionId || randomUUID();
      const activeChatSessionId = chatSessionId || DEFAULT_AI_CHAT_SESSION_ID;
      const controller = new AbortController();
      activeStreams.set(sessionId, controller);

      startAiActivity(sessionId, message);

      for (const [sid, rec] of continuations) {
        if (rec.chatSessionId === activeChatSessionId) {
          continuations.delete(sid);
          log.info(`[ai-agent] 新提问作废了待续跑记录 ${sid}`);
        }
      }

      void (async () => {
        try {
          const sessionResolution = await resolveAiChatSession(DB, activeChatSessionId);
          if (sessionResolution.ok === false) {
            event.sender.send("ai-stream:error", {
              sessionId,
              error: sessionResolution.reason,
            });
            return;
          }
          const aiConfig = await configManager.getAiConfig();
          if (!aiConfig.apiKey) {
            event.sender.send("ai-stream:error", {
              sessionId,
              error: "请先在设置中配置AI API Key",
            });
            return;
          }

          const tools = getEnabledTools();
          log.info(`[ai-agent] session ${sessionId} tools=${tools.map(t => t.name).join(",")}`);

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

          setToolContext({ DB, aiConfig });

          const sender = event.sender;

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
            log.error(`[ai-agent] compact failed, continue without compaction:`, compactErr);
          }

          const hotState = await getHotState(DB, activeChatSessionId);
          const chatHistory: BaseMessage[] = composeHistory(hotState);

          const baseSystemMessage = await AGENT_SYSTEM_PROMPT.formatMessages({
            history: [],
            question: "",
          }).then((msgs) => msgs[0]);

          const memoryBlock = composeMemoryBlock(longTermMemory.recall(message));
          const memoryMessage: BaseMessage[] = memoryBlock
            ? [new SystemMessage(memoryBlock)]
            : [];

          const skillMessages = skillId
            ? await buildSkillMessages(DB, skillId, message)
            : null;

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
          const blockBuilder = new BlockBuilder();

          const result = await runAgent({
            model: modelWithTools,
            messages: lcMessages,
            tools,
            signal: controller.signal,
            maxIterations: 6,
            callbacksFactory: (agentIteration: number) => [
              new ObservabilityCallback({
                provider: aiConfig.provider,
                defaultModel: aiConfig.model,
                sessionId: activeChatSessionId,
                agentIteration,
              }),
            ],
            onEvent: (ev) => {
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
                setAiActivityTool(sessionId, ev.toolCall!.name);
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
          const finalText = accumulatedText || result.content;

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
          endAiActivity(sessionId);
        }
      })().catch((err) => {
        log.error(`[ai-agent] session ${sessionId} 未被内部捕获的异常:`, err);
      });

      return { sessionId };
    }
  );

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
        const finalText = accumulatedText || result.content;
        const blocks = [...priorBlocks, ...blockBuilder.blocks()];

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

  ipcMain.handle("clear-ai-chat", async () => {
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

  ipcMain.handle("get-ai-usage-stats", async () => {
    return usageStatsService.getStats();
  });

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
      return await configManager.getAiConfig();
    } catch (error) {
      log.error("获取AI配置失败", error);
      return { provider: 'deepseek', apiKey: '', model: '', baseUrl: '' };
    }
  });

  ipcMain.handle("set-ai-config", async (event: IpcMainInvokeEvent, provider: string, apiKey: string, model: string, baseUrl: string) => {
    try {
      await configManager.setAiConfig(provider as any, apiKey, model, baseUrl);
      return true;
    } catch (error) {
      log.error("设置AI配置失败", error);
      return false;
    }
  });

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

