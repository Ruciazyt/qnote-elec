import { log } from "../system/log";
import type { IslandAiActivity } from "../../../shared/island/island";

interface AiActivity {
  sessionId: string;
  title: string;
  startedAt: number;
  tool: string | null;
}

let current: AiActivity | null = null;

type Listener = (activity: IslandAiActivity | null) => void;
const listeners = new Set<Listener>();

const TITLE_MAX_LENGTH = 48;

function notify(): void {
  const snapshot = getAiActivity();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      log.warn("[aiActivity] 通知监听器失败", err);
    }
  }
}

export function startAiActivity(sessionId: string, title: string): void {
  const trimmed = (title || "").replace(/\s+/g, " ").trim();
  current = {
    sessionId,
    title: trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH)}…` : trimmed,
    startedAt: Date.now(),
    tool: null,
  };
  log.info("[aiActivity] 任务开始", { sessionId, title: current.title });
  notify();
}

export function setAiActivityTool(sessionId: string, tool: string): void {
  if (!current || current.sessionId !== sessionId) return;
  current.tool = tool;
  notify();
}

export function endAiActivity(sessionId: string): void {
  if (!current || current.sessionId !== sessionId) return;
  current = null;
  log.info("[aiActivity] 任务结束", { sessionId });
  notify();
}

export function getAiActivity(): IslandAiActivity {
  if (!current) {
    return { running: false, title: "", sessionId: null, startedAt: null, tool: null };
  }
  return {
    running: true,
    title: current.title,
    sessionId: current.sessionId,
    startedAt: current.startedAt,
    tool: current.tool,
  };
}

export function onAiActivityChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
