import { log } from "../system/log";

export interface AiChatChangedPayload {
  sessionId: string;
}

type Listener = (payload: AiChatChangedPayload) => void;

const listeners = new Set<Listener>();

export function onAiChatChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAiChatChanged(sessionId: string): void {
  for (const listener of listeners) {
    try {
      listener({ sessionId });
    } catch (err) {
      log.error("[ai-chat] 派发会话变更事件失败", err);
    }
  }
}
