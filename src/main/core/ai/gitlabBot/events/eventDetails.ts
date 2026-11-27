import { gitlabGet } from "../../tools/gitlab/api/client";
import { gitlabEndpoints } from "../../tools/gitlab/api/endpoints";
import type {
  GitlabIssue,
  GitlabMergeRequest,
  GitlabNote,
} from "../../tools/gitlab/api/types";
import type { GitlabEvent } from "./webhook";
import { parseTriggerPointer, type TriggerPointer } from "./triggerPointer";

export type GitlabEventResult =
  | { ok: true; event: GitlabEvent }
  | { ok: false; stage: "detail" | "parse"; reason: string };

function baseEvent(eventType: string, pointer: TriggerPointer): GitlabEvent {
  return {
    eventType: eventType || pointer.kind,
    objectKind: pointer.kind,
    projectId: pointer.projectId,
    projectPath: pointer.projectPath,
    defaultBranch: pointer.defaultBranch || undefined,
    author: pointer.author || undefined,
    labels: [],
  };
}

async function getNoteDetail(
  eventType: string,
  pointer: TriggerPointer
): Promise<GitlabEvent> {
  const isMergeRequest = pointer.noteableType === "MergeRequest";
  const iid = isMergeRequest ? pointer.mrIid : pointer.issueIid;
  if (!iid || !pointer.objectId) {
    throw new Error("指针里缺少评论所属对象的 iid");
  }
  if (isMergeRequest) {
    const mr = await gitlabGet<GitlabMergeRequest>(
      gitlabEndpoints.mergeRequest(String(pointer.projectId), iid)
    );
    const note = await gitlabGet<GitlabNote>(
      gitlabEndpoints.mergeRequestNote(
        String(pointer.projectId),
        iid,
        pointer.objectId
      )
    );
    return {
      ...baseEvent(eventType, pointer),
      comment: note.body,
      noteId: note.id,
      objectId: note.id,
      mrIid: mr.iid,
      title: mr.title,
      description: mr.description,
      webUrl: mr.web_url,
      author: note.author?.username || pointer.author || undefined,
    };
  }
  const issue = await gitlabGet<GitlabIssue>(
    gitlabEndpoints.issue(String(pointer.projectId), iid)
  );
  const note = await gitlabGet<GitlabNote>(
    gitlabEndpoints.issueNote(
      String(pointer.projectId),
      iid,
      pointer.objectId
    )
  );
  return {
    ...baseEvent(eventType, pointer),
    comment: note.body,
    noteId: note.id,
    objectId: note.id,
    issueIid: issue.iid,
    title: issue.title,
    description: issue.description,
    labels: issue.labels ?? [],
    webUrl: issue.web_url,
    author: note.author?.username || pointer.author || undefined,
  };
}

async function getIssueDetail(
  eventType: string,
  pointer: TriggerPointer
): Promise<GitlabEvent> {
  const iid = pointer.objectIid || pointer.issueIid;
  if (!iid) throw new Error("指针里缺少 issue 的 iid");
  const issue = await gitlabGet<GitlabIssue>(
    gitlabEndpoints.issue(String(pointer.projectId), iid)
  );
  return {
    ...baseEvent(eventType, pointer),
    objectId: pointer.objectId || undefined,
    issueIid: issue.iid,
    title: issue.title,
    description: issue.description,
    labels: issue.labels ?? [],
    webUrl: issue.web_url,
    action: "open",
  };
}

async function getMergeRequestDetail(
  eventType: string,
  pointer: TriggerPointer
): Promise<GitlabEvent> {
  const iid = pointer.objectIid || pointer.mrIid;
  if (!iid) throw new Error("指针里缺少合并请求的 iid");
  const mr = await gitlabGet<GitlabMergeRequest>(
    gitlabEndpoints.mergeRequest(String(pointer.projectId), iid)
  );
  return {
    ...baseEvent(eventType, pointer),
    objectId: pointer.objectId || undefined,
    mrIid: mr.iid,
    title: mr.title,
    description: mr.description,
    branch: mr.source_branch,
    webUrl: mr.web_url,
    action: "open",
  };
}

export async function getGitlabEvent(
  eventType: string,
  payload: unknown
): Promise<GitlabEventResult> {
  const pointer = parseTriggerPointer(payload);
  if (!pointer) {
    return {
      ok: false,
      stage: "parse",
      reason: "GitLab 指针报文无效",
    };
  }
  try {
    if (pointer.kind === "note") {
      return { ok: true, event: await getNoteDetail(eventType, pointer) };
    }
    if (pointer.kind === "issue") {
      return { ok: true, event: await getIssueDetail(eventType, pointer) };
    }
    if (pointer.kind === "merge_request") {
      return {
        ok: true,
        event: await getMergeRequestDetail(eventType, pointer),
      };
    }
    return {
      ok: false,
      stage: "detail",
      reason: "暂不处理 " + pointer.kind + " 事件",
    };
  } catch (err) {
    return {
      ok: false,
      stage: "detail",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
