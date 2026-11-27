import { app } from "electron";
import * as path from "node:path";
import { log } from "../../system/log";
import {
  describeGitlabEvent,
  parseGitlabEvent,
  type GitlabEvent,
} from "./webhook";
import { buildWorkBranchName, prepareRepoWorkspace } from "./repoWorkspace";
import { runGitlabTask } from "./task";
import { resolveEventPayload } from "./eventHydrator";
import { getGitlabConfig } from "../tools/gitlab/runtime/config";
import { GitlabEventQueue, type EnqueueResult } from "./queue";

export type GitlabBotEventSource = "webhook" | "relay";

export interface TriggerOutcome {
  accepted: boolean;
  reason: string;
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === "/") end -= 1;
  return value.slice(0, end);
}

export function gitlabWorkspaceBaseDir(): string {
  try {
    return path.join(app.getPath("userData"), "gitlab-workspaces");
  } catch {
    return path.join(process.cwd(), ".data", "gitlab-workspaces");
  }
}

export class GitlabBotTrigger {
  private readonly queue: GitlabEventQueue;

  constructor(private readonly DB: any) {
    this.queue = new GitlabEventQueue((event, instruction) =>
      this.execute(event, instruction)
    );
  }

  async handle(
    eventType: string,
    payload: any
  ): Promise<TriggerOutcome> {
    const hydrated = await resolveEventPayload(payload);
    if (!hydrated.ok) {
      return { accepted: false, reason: hydrated.reason ?? "报文解析失败" };
    }
    const event = parseGitlabEvent(eventType, hydrated.payload);
    if (!event) {
      return { accepted: false, reason: "webhook 报文解析失败" };
    }
    const result = this.enqueue(event, "webhook");
    if (!result.accepted) {
      log.info("[gitlab-bot] 事件未入队", {
        reason: result.reason,
        project: event.projectPath,
        event: event.eventType,
      });
      return { accepted: false, reason: result.reason };
    }
    return { accepted: true, reason: result.reason };
  }

  enqueue(
    event: GitlabEvent,
    source: GitlabBotEventSource = "relay"
  ): EnqueueResult {
    log.info("[gitlab-bot] 收到 GitLab 消息", {
      source,
      ...describeGitlabEvent(event),
    });
    return this.queue.enqueue(event);
  }

  private async execute(
    event: GitlabEvent,
    instruction: string
  ): Promise<void> {
    const gitlab = getGitlabConfig();
    if (!gitlab.baseUrl || !gitlab.token) {
      log.warn("[gitlab-bot] 没配 GitLab 实例地址或令牌，任务跳过");
      return;
    }

    const repoUrl =
      event.repoUrl ||
      `${stripTrailingSlashes(gitlab.baseUrl)}/${event.projectPath}.git`;
    const branch = buildWorkBranchName(event);

    log.info("[gitlab-bot] 开始任务", {
      project: event.projectPath,
      branch,
      instruction: instruction.slice(0, 120),
    });

    const workspace = await prepareRepoWorkspace({
      baseDir: gitlabWorkspaceBaseDir(),
      projectPath: event.projectPath,
      repoUrl,
      branch,
      defaultBranch: event.defaultBranch,
      token: gitlab.token,
    });

    const result = await runGitlabTask({
      DB: this.DB,
      event,
      instruction,
      repoDir: workspace.dir,
      branch: workspace.branch,
      defaultBranch: event.defaultBranch || "main",
      allowPush: true,
    });

    log.info("[gitlab-bot] 任务结束", {
      project: event.projectPath,
      ok: result.ok,
      error: result.error,
    });
  }
}
