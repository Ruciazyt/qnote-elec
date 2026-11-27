import { gitlabRequest } from "../tools/gitlab/api/client";
import { gitlabEndpoints } from "../tools/gitlab/api/endpoints";
import type {
  GitlabIssue,
  GitlabMergeRequest,
  GitlabNote,
} from "../tools/gitlab/api/types";
import { parseTriggerPointer, type TriggerPointer } from "./triggerPointer";

export interface ResolvedPayload {
  ok: boolean;
  payload?: Record<string, unknown>;
  reason?: string;
}

async function fetchIssue(
  projectId: number,
  iid: number
): Promise<GitlabIssue> {
  const result = await gitlabRequest<GitlabIssue>({
    method: "GET",
    path: gitlabEndpoints.issue(String(projectId), iid),
    idempotent: true,
  });
  return result.data;
}

async function fetchIssueNote(
  projectId: number,
  iid: number,
  noteId: number
): Promise<GitlabNote> {
  const result = await gitlabRequest<GitlabNote>({
    method: "GET",
    path: gitlabEndpoints.issueNote(String(projectId), iid, noteId),
    idempotent: true,
  });
  return result.data;
}

async function fetchMergeRequest(
  projectId: number,
  iid: number
): Promise<GitlabMergeRequest> {
  const result = await gitlabRequest<GitlabMergeRequest>({
    method: "GET",
    path: gitlabEndpoints.mergeRequest(String(projectId), iid),
    idempotent: true,
  });
  return result.data;
}

async function fetchMergeRequestNote(
  projectId: number,
  iid: number,
  noteId: number
): Promise<GitlabNote> {
  const result = await gitlabRequest<GitlabNote>({
    method: "GET",
    path: gitlabEndpoints.mergeRequestNote(String(projectId), iid, noteId),
    idempotent: true,
  });
  return result.data;
}

function basePayload(pointer: TriggerPointer): Record<string, unknown> {
  return {
    object_kind: pointer.kind,
    event_type: pointer.eventType || pointer.kind,
    user: { username: pointer.author },
    project: {
      id: pointer.projectId,
      path_with_namespace: pointer.projectPath,
      default_branch: pointer.defaultBranch,
    },
  };
}

function issueShape(issue: GitlabIssue): Record<string, unknown> {
  return {
    iid: issue.iid,
    title: issue.title,
    description: issue.description ?? "",
    labels: issue.labels ?? [],
    web_url: issue.web_url,
  };
}

function mergeRequestShape(mr: GitlabMergeRequest): Record<string, unknown> {
  return {
    iid: mr.iid,
    title: mr.title,
    description: mr.description ?? "",
    labels: [],
    source_branch: mr.source_branch,
    web_url: mr.web_url,
  };
}

async function hydrateNote(
  pointer: TriggerPointer
): Promise<ResolvedPayload> {
  const payload = basePayload(pointer);
  const isMergeRequest = pointer.noteableType === "MergeRequest";
  const iid = isMergeRequest ? pointer.mrIid : pointer.issueIid;
  if (!iid || !pointer.objectId) {
    return { ok: false, reason: "指针里缺少评论所属对象的 iid" };
  }
  if (isMergeRequest) {
    const mr = await fetchMergeRequest(pointer.projectId, iid);
    const note = await fetchMergeRequestNote(pointer.projectId, iid, pointer.objectId);
    payload.object_attributes = {
      id: note.id,
      note: note.body,
      noteable_type: "MergeRequest",
      action: "create",
    };
    payload.merge_request = mergeRequestShape(mr);
    payload.user = { username: note.author?.username || pointer.author };
    return { ok: true, payload };
  }
  const issue = await fetchIssue(pointer.projectId, iid);
  const note = await fetchIssueNote(pointer.projectId, iid, pointer.objectId);
  payload.object_attributes = {
    id: note.id,
    note: note.body,
    noteable_type: "Issue",
    action: "create",
  };
  payload.issue = issueShape(issue);
  payload.user = { username: note.author?.username || pointer.author };
  return { ok: true, payload };
}

async function hydrateIssue(
  pointer: TriggerPointer
): Promise<ResolvedPayload> {
  const payload = basePayload(pointer);
  const iid = pointer.objectIid || pointer.issueIid;
  if (!iid) return { ok: false, reason: "指针里缺少 issue 的 iid" };
  const issue = await fetchIssue(pointer.projectId, iid);
  payload.object_attributes = {
    id: pointer.objectId,
    iid: issue.iid,
    title: issue.title,
    description: issue.description ?? "",
    action: "open",
  };
  payload.issue = issueShape(issue);
  return { ok: true, payload };
}

async function hydrateMergeRequest(
  pointer: TriggerPointer
): Promise<ResolvedPayload> {
  const payload = basePayload(pointer);
  const iid = pointer.objectIid || pointer.mrIid;
  if (!iid) return { ok: false, reason: "指针里缺少合并请求的 iid" };
  const mr = await fetchMergeRequest(pointer.projectId, iid);
  payload.object_attributes = {
    id: pointer.objectId,
    iid: mr.iid,
    title: mr.title,
    description: mr.description ?? "",
    source_branch: mr.source_branch,
    labels: [],
    url: mr.web_url,
    action: "open",
  };
  payload.merge_request = mergeRequestShape(mr);
  return { ok: true, payload };
}

export async function hydrateTriggerPointer(
  pointer: TriggerPointer
): Promise<ResolvedPayload> {
  try {
    if (pointer.kind === "note") return await hydrateNote(pointer);
    if (pointer.kind === "issue") return await hydrateIssue(pointer);
    if (pointer.kind === "merge_request") {
      return await hydrateMergeRequest(pointer);
    }
    return { ok: false, reason: "暂不处理 " + pointer.kind + " 事件" };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function resolveEventPayload(payload: unknown): Promise<ResolvedPayload> {
  const pointer = parseTriggerPointer(payload);
  if (!pointer) {
    return {
      ok: true,
      payload: payload as Record<string, unknown>,
    };
  }
  return hydrateTriggerPointer(pointer);
}
