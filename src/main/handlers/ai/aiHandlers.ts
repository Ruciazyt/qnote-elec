import { ipcMain, IpcMainInvokeEvent, dialog } from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getMainWindow } from "../../core/window/mainWindow";
import { startAiActivity, setAiActivityTool, endAiActivity } from "../../core/ai/aiActivity";
import { DEFAULT_AI_CHAT_SESSION_ID } from "../../../shared/ai/constants/aiChat";
import { ensureActiveAiChatSession } from "../../core/ai/chatSession";
import { persistAiChatExchange } from "../../core/ai/chatPersistence";
import { onAiChatChanged } from "../../core/ai/chatEvents";
import { aiService } from "../../core/ai/aiService";
import { configManager } from "../../core/system/config";
import { log } from "../../core/system/log";
import { BlockBuilder, parseBlocks } from "../../../shared/ai/aiBlocks";
import {
  normalizeAiImages,
  parseAiImages,
  type AiImageAttachment,
} from "../../../shared/ai/aiImages";
import {
  composeMemoryBlock,
  resolveToolDisplay,
} from "../../core/ai/tools/index";
import {
  buildOpencodeParts,
  toOpencodeProvider,
} from "../../core/ai/runtime/opencode/bridge";
import { getOpencodeRuntime } from "../../core/ai/runtime/opencode/runtime";
import { initToolContext, updateToolContext } from "../../core/ai/toolContext";
import { longTermMemory } from "../../core/ai/memory/longTermMemory";
import { initUsageRecorder, UsageStatsService } from "../../core/ai/observability/index";
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

export function registerAiHandlers(DB: any, fileWriter: FileWriter) {
  const activeStreams = new Map<string, AbortController>();

  initToolContext({ DB, browser: browserAutomation, notes: fileWriter });

  initUsageRecorder(DB);
  const usageStatsService = new UsageStatsService(DB);

  onAiChatChanged((payload) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("ai-chat:changed", payload);
  });

  ipcMain.on("cancel-ai-message", (_event: IpcMainInvokeEvent, sessionId: string) => {
    const controller = activeStreams.get(sessionId);
    if (controller) {
      log.info(`[ai-stream] cancel session ${sessionId}`);
      controller.abort();
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

      void (async () => {
        try {
          const sessionCheck = await ensureActiveAiChatSession(DB, activeChatSessionId);
          if (sessionCheck.ok === false) {
            event.sender.send("ai-stream:error", {
              sessionId,
              error: sessionCheck.reason,
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

          updateToolContext({ DB, aiConfig });

          const sender = event.sender;

          const provider = toOpencodeProvider(aiConfig);
          const runtime = getOpencodeRuntime();

          const attachedImages = normalizeAiImages(images);
          if (attachedImages.length > 0) {
            log.info(
              `[ai-agent] session ${sessionId} 收到 ${attachedImages.length} 张图片`
            );
          }

          const memoryBlock = composeMemoryBlock(longTermMemory.recall(message));
          const skillMessages = skillId
            ? await buildSkillMessages(DB, skillId, message)
            : null;
          const parts = buildOpencodeParts({
            message,
            images: attachedImages,
            memoryBlock,
            skillMessages,
          });

          let accumulatedText = "";
          const blockBuilder = new BlockBuilder();
          const finishStoppedExchange = async () => {
            const stoppedTools = blockBuilder.finishPendingTools("生成已停止");
            for (const call of stoppedTools) {
              sender.send("ai-stream:tool-result", {
                sessionId,
                id: call.id,
                name: call.name,
                result: call.result,
                isError: call.isError,
              });
            }
            try {
              await persistAiChatExchange(
                DB,
                activeChatSessionId,
                message,
                accumulatedText,
                blockBuilder.blocks(),
                attachedImages
              );
            } catch (dbErr) {
              log.error(`[ai-agent] session ${sessionId} persist canceled exchange failed:`, dbErr);
            }
            sender.send("ai-stream:end", { sessionId, content: accumulatedText });
          };

          let result: Awaited<ReturnType<typeof runtime.runTurn>>;
          try {
            result = await runtime.runTurn({
              chatSessionId: activeChatSessionId,
              parts,
              provider,
              signal: controller.signal,
              handlers: {
                onThinking: (delta) => {
                  if (!delta || controller.signal.aborted) return;
                  blockBuilder.pushThinking(delta);
                  sender.send("ai-stream:thinking", { sessionId, delta });
                },
                onText: (delta) => {
                  if (!delta || controller.signal.aborted) return;
                  accumulatedText += delta;
                  blockBuilder.pushText(delta);
                  sender.send("ai-stream:chunk", { sessionId, delta });
                },
                onToolCall: (call) => {
                  const display = resolveToolDisplay(call.name);
                  blockBuilder.pushToolCall({
                    id: call.id,
                    name: display.name,
                    title: display.title,
                    args: call.args,
                  });
                  setAiActivityTool(sessionId, display.name);
                  sender.send("ai-stream:tool-call", {
                    sessionId,
                    id: call.id,
                    name: display.name,
                    title: display.title,
                    args: call.args,
                  });
                },
                onToolResult: (toolResult) => {
                  blockBuilder.pushToolResult(
                    toolResult.id,
                    toolResult.content,
                    toolResult.isError
                  );
                  sender.send("ai-stream:tool-result", {
                    sessionId,
                    id: toolResult.id,
                    name: toolResult.name,
                    result: toolResult.content,
                    isError: toolResult.isError,
                  });
                },
                onCompacted: () => {
                  sender.send("ai-stream:compacting", { sessionId, phase: "done" });
                },
              },
            });
          } catch (err) {
            if (!controller.signal.aborted) throw err;
            await finishStoppedExchange();
            return;
          }

          if (controller.signal.aborted) {
            await finishStoppedExchange();
            return;
          }

          if (result.error) {
            throw new Error(result.error);
          }

          const blocks = blockBuilder.blocks();
          const finalText = accumulatedText;

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

          sender.send("ai-stream:end", { sessionId, content: finalText });
        } catch (err) {
          if (controller.signal.aborted) return;
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error(`[ai-agent] session ${sessionId} failed:`, err);
          event.sender.send("ai-stream:error", { sessionId, error: errMsg });
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

