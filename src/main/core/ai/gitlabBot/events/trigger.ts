import { app } from "electron";
import * as path from "node:path";
import { log } from "../../../system/log";
import {
  describeGitlabEvent,
  type GitlabEvent,
} from "./webhook";
import { buildWorkBranchName, prepareRepoWorkspace } from "../task/repoWorkspace";
import { runGitlabTask } from "../task/task";
import { getGitlabConfig } from "../../tools/gitlab/runtime/config";
import { GitlabEventQueue, type EnqueueResult } from "./queue";

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

  enqueue(event: GitlabEvent): EnqueueResult {
    log.info("[gitlab-bot] 收到 GitLab 消息", {
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
      throw new Error("没配 GitLab 实例地址或令牌，任务未执行");
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
      allowPush: !gitlab.readOnly,
    });

    if (!result.ok) {
      throw new Error(result.error || "任务执行失败");
    }
    log.info("[gitlab-bot] 任务结束", {
      project: event.projectPath,
      ok: result.ok,
    });
  }
}
