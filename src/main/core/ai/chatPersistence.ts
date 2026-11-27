import { buildSessionPreview } from "./nativeAi";
import { emitAiChatChanged } from "./chatEvents";
import type { AiImageAttachment } from "../../../shared/ai/aiImages";
import {
  serializeBlocks,
  type AssistantBlock,
} from "../../../shared/ai/aiBlocks";
import { serializeAiImages } from "../../../shared/ai/aiImages";

export interface PersistExchangeOptions {
  /** 不落用户消息 —— 外部触发的任务只留 AI 回复与动作记录 */
  includeUserMessage?: boolean;
  /** 会话预览的来源，不给就用用户消息 */
  titleSource?: string;
}

export async function startAiChatAssistantRow(
  DB: any,
  chatSessionId: string,
  previewSource: string
): Promise<number> {
  const now = new Date();
  const preview = buildSessionPreview(previewSource);
  const inserted = await DB("ai_chat")
    .insert({
      session_id: chatSessionId,
      role: "assistant",
      content: "",
      blocks: "",
      created_at: now,
    })
    .returning("id");
  await DB("ai_chat_session")
    .where({ id: chatSessionId })
    .update({ preview, updated_at: now });
  emitAiChatChanged(chatSessionId);
  return Number(inserted?.[0]?.id ?? 0);
}

export async function updateAiChatAssistantRow(
  DB: any,
  rowId: number,
  content: string,
  blocks: AssistantBlock[]
): Promise<void> {
  if (!rowId) return;
  await DB("ai_chat")
    .where({ id: rowId })
    .update({ content, blocks: serializeBlocks(blocks) });
}

export async function removeAiChatRow(DB: any, rowId: number): Promise<void> {
  if (!rowId) return;
  await DB("ai_chat").where({ id: rowId }).del();
}

export async function persistAiChatExchange(
  DB: any,
  chatSessionId: string,
  userMessage: string,
  assistantMessage: string,
  blocks?: AssistantBlock[],
  images?: AiImageAttachment[],
  options?: PersistExchangeOptions
): Promise<{ rowIds: number[] }> {
  const createdAt = new Date();
  const includeUserMessage = options?.includeUserMessage !== false;
  const titleSource =
    (options?.titleSource ?? userMessage).trim() ||
    (images && images.length > 0 ? "[图片]" : "");
  const title = titleSource.replace(/\s+/g, " ").trim().slice(0, 48) || "新建对话";
  const preview = buildSessionPreview(titleSource);

  let inserted: Array<{ id: number }> = [];

  await DB.transaction(async (transaction: any) => {
    const session = await transaction("ai_chat_session")
      .where({ id: chatSessionId })
      .first("title");
    if (!session) throw new Error(`AI聊天会话不存在: ${chatSessionId}`);

    const rows: Array<Record<string, unknown>> = [];
    if (includeUserMessage) {
      rows.push({
        session_id: chatSessionId,
        role: "user",
        content: userMessage,
        images: serializeAiImages(images ?? []),
        created_at: createdAt,
      });
    }
    rows.push({
      session_id: chatSessionId,
      role: "assistant",
      content: assistantMessage,
      blocks: serializeBlocks(blocks ?? []),
      created_at: createdAt,
    });

    inserted = await transaction("ai_chat").insert(rows).returning("id");

    await transaction("ai_chat_session")
      .where({ id: chatSessionId })
      .update({
        title: session.title === "新建对话" ? title : session.title,
        preview,
        updated_at: createdAt,
      });
  });

  emitAiChatChanged(chatSessionId);

  return { rowIds: inserted.map((r) => Number(r.id)) };
}
