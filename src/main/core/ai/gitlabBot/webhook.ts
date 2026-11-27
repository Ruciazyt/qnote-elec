import type { GitlabBotConfig } from "./configStore";

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

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      labels.push(item);
      continue;
    }
    if (item && typeof item === "object" && typeof (item as any).title === "string") {
      labels.push((item as any).title);
    }
  }
  return labels;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readId(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : undefined;
}

export function parseGitlabEvent(
  eventType: string,
  payload: any
): GitlabEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const project = payload.project ?? {};
  const projectPath = readString(project.path_with_namespace);
  if (!projectPath) return null;

  const kind = readString(payload.object_kind) ?? "";
  const event: GitlabEvent = {
    eventType: eventType || kind,
    objectKind: kind,
    projectId: Number(project.id) || 0,
    projectPath,
    defaultBranch: readString(project.default_branch),
    repoUrl: readString(project.http_url_to_repo),
    labels: [],
  };

  const user = payload.user ?? {};
  event.author = readString(user.username);

  if (kind === "note") {
    const attributes = payload.object_attributes ?? {};
    event.comment = readString(attributes.note) ?? "";
    event.noteId = readId(attributes.id);
    event.objectId = event.noteId;
    const noteableType = readString(attributes.noteable_type);
    const noteable =
      noteableType === "MergeRequest"
        ? payload.merge_request
        : payload.issue;
    if (noteable && typeof noteable === "object") {
      const iid = Number(noteable.iid);
      if (Number.isFinite(iid) && iid > 0) {
        if (noteableType === "MergeRequest") event.mrIid = iid;
        else event.issueIid = iid;
      }
      event.title = readString(noteable.title);
      event.description = readString(noteable.description);
      event.labels = normalizeLabels(noteable.labels);
      event.webUrl = readString(noteable.web_url);
    }
    return event;
  }

  if (kind === "issue") {
    const issue = payload.issue ?? {};
    event.objectId = readId(payload.object_attributes?.id) ?? readId(issue.id);
    const iid = Number(issue.iid);
    if (Number.isFinite(iid) && iid > 0) event.issueIid = iid;
    event.title = readString(issue.title);
    event.description = readString(issue.description);
    event.labels = normalizeLabels(issue.labels);
    event.webUrl = readString(issue.web_url);
    event.action = readString(payload.object_attributes?.action);
    return event;
  }

  if (kind === "merge_request") {
    const attributes = payload.object_attributes ?? {};
    event.objectId = readId(attributes.id);
    const iid = Number(attributes.iid);
    if (Number.isFinite(iid) && iid > 0) event.mrIid = iid;
    event.title = readString(attributes.title);
    event.description = readString(attributes.description);
    event.labels = normalizeLabels(attributes.labels);
    event.action = readString(attributes.action);
    event.branch = readString(attributes.source_branch);
    event.webUrl = readString(attributes.url);
    return event;
  }

  return event;
}

export function collectTriggerText(event: GitlabEvent): string {
  return [event.comment, event.title, event.description]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("\n");
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
  if (!config.signingToken && !config.secretToken) {
    return { ok: false, reason: "没配 webhook 密钥，所有请求都不放行" };
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
  const hit = findTriggerWord(collectTriggerText(event), config.triggerWords);
  if (!hit) {
    return { ok: false, reason: "没有命中触发词" };
  }
  const source =
    event.comment?.trim() ||
    [event.title, event.description].filter(Boolean).join("\n") ||
    "";
  const instruction = stripTriggerWord(source, hit).trim();
  if (!instruction) {
    return { ok: false, reason: "触发词后面没有指令内容" };
  }
  return { ok: true, reason: `命中触发词「${hit}」`, instruction };
}
