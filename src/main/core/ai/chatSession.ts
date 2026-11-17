import { DEFAULT_AI_CHAT_SESSION_ID } from "../../../shared/ai/constants/aiChat";

export const AI_CHAT_SESSION_DELETED = "此对话已不存在或已删除";

export type AiChatSessionResolution =
  | { ok: true }
  | { ok: false; reason: string };

export async function ensureAiChatSession(
  DB: any,
  id: string,
  title = "AI 助手"
): Promise<void> {
  const existingSession = await DB.from("ai_chat_session").where({ id }).first("id");
  if (existingSession) return;

  const now = new Date();
  try {
    await DB.from("ai_chat_session").insert({
      id,
      title,
      preview: "",
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    const created = await DB.from("ai_chat_session").where({ id }).first("id");
    if (!created) throw err;
  }
}

export async function resolveAiChatSession(
  DB: any,
  activeChatSessionId: string
): Promise<AiChatSessionResolution> {
  const existingSession = await DB.from("ai_chat_session")
    .where({ id: activeChatSessionId })
    .first("id");
  if (existingSession) return { ok: true };

  if (activeChatSessionId !== DEFAULT_AI_CHAT_SESSION_ID) {
    return { ok: false, reason: AI_CHAT_SESSION_DELETED };
  }

  await ensureAiChatSession(DB, activeChatSessionId, "新建对话");
  return { ok: true };
}
