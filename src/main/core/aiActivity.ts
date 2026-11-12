import { log } from "../utils/log";
import type { IslandAiActivity } from "../../shared/island";

/**
 * AI 任务状态跟踪
 *
 * 灵动岛的「Agent 状态灯」那一页要显示「现在有没有 AI 在跑、跑的是哪一句」。
 * AI 对话本身发生在主窗口的渲染层里，但**主进程是唯一知道任务起止的地方**
 * —— send-ai-agent-stream 的入口在这边，结束（end / error / 中止）也在这边。
 *
 * 所以状态跟踪放在主进程，渲染层只读。
 */
interface AiActivity {
  sessionId: string;
  title: string;
  startedAt: number;
  tool: string | null;
}

let current: AiActivity | null = null;

type Listener = (activity: IslandAiActivity | null) => void;
const listeners = new Set<Listener>();

/** 标题最多留这么多字 —— 岛上的位置只有一行 */
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

/** 一轮 AI 任务开始 */
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

/** 正在调用某个工具 —— 状态灯旁边可以显示「在读文件」这种即时反馈 */
export function setAiActivityTool(sessionId: string, tool: string): void {
  if (!current || current.sessionId !== sessionId) return;
  current.tool = tool;
  notify();
}

/** 一轮 AI 任务结束（正常结束、出错、被中止都走这里） */
export function endAiActivity(sessionId: string): void {
  if (!current || current.sessionId !== sessionId) return;
  current = null;
  log.info("[aiActivity] 任务结束", { sessionId });
  notify();
}

/** 当前状态快照 */
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

/** 订阅状态变化 —— 岛上的状态灯靠它实时更新 */
export function onAiActivityChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
