export interface TriggerPointer {
  kind: string;
  eventType: string;
  projectId: number;
  projectPath: string;
  defaultBranch: string;
  author: string;
  objectId: number;
  objectIid: number;
  noteableType: string;
  noteableId: number;
  issueIid: number;
  mrIid: number;
  action: string;
}

const TEMPLATE_FIELDS: Record<string, string> = {
  object_kind: "{{object_kind}}",
  event_type: "{{event_type}}",
  project_id: "{{project.id}}",
  project_path: "{{project.path_with_namespace}}",
  default_branch: "{{project.default_branch}}",
  author: "{{user.username}}",
  object_id: "{{object_attributes.id}}",
  object_iid: "{{object_attributes.iid}}",
  noteable_type: "{{object_attributes.noteable_type}}",
  noteable_id: "{{object_attributes.noteable_id}}",
  issue_iid: "{{issue.iid}}",
  mr_iid: "{{merge_request.iid}}",
  action: "{{object_attributes.action}}",
};

/**
 * GitLab 自定义 webhook 模板：只输出 ASCII 指针，不带任何自由文本。
 *
 * GitLab 会给 trigger pipeline 强制注入 TRIGGER_PAYLOAD（file 类型变量），
 * runner 生成脚本时把内容原样拼进 PowerShell 脚本 —— 里面有中文就会让
 * 整个脚本段解析失败，连带 CI 变量全丢，job 根本跑不起来。
 * 模板里只留 id 与路径，原始报文由 QNote 按 id 回 GitLab 取。
 *
 * 占位符语法是 {{path}} 不带空格；带空格会渲染成 null。
 */
export const TRIGGER_POINTER_TEMPLATE = JSON.stringify(TEMPLATE_FIELDS);

function readText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return "";
  return trimmed;
}

function readNumber(value: unknown): number {
  const text = readText(value);
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isTriggerPointer(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return "object_id" in record && !("object_attributes" in record);
}

export function parseTriggerPointer(payload: unknown): TriggerPointer | null {
  if (!isTriggerPointer(payload)) return null;
  const record = payload as Record<string, unknown>;
  const pointer: TriggerPointer = {
    kind: readText(record.object_kind),
    eventType: readText(record.event_type),
    projectId: readNumber(record.project_id),
    projectPath: readText(record.project_path),
    defaultBranch: readText(record.default_branch),
    author: readText(record.author),
    objectId: readNumber(record.object_id),
    objectIid: readNumber(record.object_iid),
    noteableType: readText(record.noteable_type),
    noteableId: readNumber(record.noteable_id),
    issueIid: readNumber(record.issue_iid),
    mrIid: readNumber(record.mr_iid),
    action: readText(record.action),
  };
  if (!pointer.kind || !pointer.projectId || !pointer.projectPath) return null;
  return pointer;
}
