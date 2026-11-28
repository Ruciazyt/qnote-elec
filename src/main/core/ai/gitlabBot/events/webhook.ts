import type { GitlabBotConfig } from "../config/configStore";

export const GITLAB_SUPPORTED_OBJECT_KINDS = new Set([
  "note",
  "issue",
  "merge_request",
]);

export interface GitlabEvent {
  eventType: string;
  objectKind: string;
  projectId: number;
  projectPath: string;
  defaultBranch?: string;
  repoUrl?: string;
  issueIid?: number;
  mrIid?: number;
  title?: string;
  description?: string;
  labels: string[];
  comment?: string;
  author?: string;
  action?: string;
  branch?: string;
  webUrl?: string;
  noteId?: number;
  objectId?: number;
}

export function findTriggerWord(
  text: string,
  words: string[]
): string | null {
  const lower = text.toLowerCase();
  for (const word of words) {
    const normalized = word.trim().toLowerCase();
    if (normalized && lower.includes(normalized)) return word;
  }
  return null;
}

export function stripTriggerWord(text: string, word: string): string {
  const index = text.toLowerCase().indexOf(word.trim().toLowerCase());
  if (index < 0) return text;
  return text.slice(0, index) + text.slice(index + word.trim().length);
}

export function summarizeText(text: string | undefined, limit = 120): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > limit ? flat.slice(0, limit) + "…" : flat;
}

function targetLabel(event: GitlabEvent): string {
  const parts: string[] = [];
  if (event.mrIid) parts.push(`mr!${event.mrIid}`);
  if (event.issueIid) parts.push(`issue#${event.issueIid}`);
  if (event.noteId) parts.push(`note#${event.noteId}`);
  return parts.join(" ");
}

export function describeGitlabEvent(event: GitlabEvent): Record<string, string> {
  return {
    event: event.eventType || event.objectKind,
    kind: event.objectKind,
    project: event.projectPath,
    action: event.action ?? "",
    author: event.author ?? "",
    target: targetLabel(event),
    title: summarizeText(event.title, 80),
    comment: summarizeText(event.comment, 120),
  };
}

export interface TriggerDecision {
  ok: boolean;
  reason: string;
  instruction?: string;
}

export function decideTrigger(
  event: GitlabEvent,
  config: GitlabBotConfig
): TriggerDecision {
  if (!config.enabled) {
    return { ok: false, reason: "GitLab 网关未启用" };
  }
  if (
    config.allowedProjects.length > 0 &&
    !config.allowedProjects.includes(event.projectPath)
  ) {
    return { ok: false, reason: `项目 ${event.projectPath} 不在允许列表里` };
  }
  if (!GITLAB_SUPPORTED_OBJECT_KINDS.has(event.objectKind)) {
    return { ok: false, reason: `暂不处理 ${event.eventType || event.objectKind}` };
  }
  const source =
    event.comment?.trim() ||
    [event.title, event.description].filter(Boolean).join("\n") ||
    "";
  const hit = findTriggerWord(source, config.triggerWords);
  if (!hit) {
    return { ok: false, reason: "没有命中触发词" };
  }
  const instruction = stripTriggerWord(source, hit).trim();
  if (!instruction) {
    return { ok: false, reason: "触发词后面没有指令内容" };
  }
  return { ok: true, reason: `命中触发词「${hit}」`, instruction };
}
