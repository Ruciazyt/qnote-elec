import { tool } from "../../tool";
import { z } from "zod";
import { GitlabApiError, gitlabRequest } from "../api/client";
import { gitlabEndpoints } from "../api/endpoints";
import { getGitlabConfig } from "../runtime/config";
import { TRIGGER_POINTER_TEMPLATE } from "../../../gitlabBot/events/triggerPointer";
import { getGitlabBotConfig } from "../../../gitlabBot/config/configStore";
import { projectSchema, strictObject } from "../schemas/input";
import {
  requireProject,
  requireWritable,
  runGitlabTool,
} from "../utils/helpers";
import {
  buildCiTemplate,
  buildTriggerApiUrl,
  createTrigger,
  listTriggers,
  resolveProjectId,
  upsertHook,
  GITLAB_TRIGGER_DESCRIPTION,
} from "./runnerSetup";

const HOOK_EVENTS: Record<string, boolean> = {
  note_events: true,
  issues_events: true,
  merge_requests_events: true,
  push_events: false,
  tag_push_events: false,
  confidential_issues_events: false,
  job_events: false,
  pipeline_events: false,
  wiki_page_events: false,
  releases_events: false,
};

function relayEndpoint(port: number): string {
  return `http://127.0.0.1:${port}/gitlab/relay`;
}

export const gitlabEnsureRunnerTool = tool(
  async (input: {
    project: string;
    ref?: string;
    dry_run?: boolean;
  }) => {
    return runGitlabTool("gitlab_ensure_runner", input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();

      const config = getGitlabBotConfig();
      if (!config.enabled) {
        throw new GitlabApiError(
          "QNote 的 GitLab 网关没启用，先在设置页打开",
          0,
          false
        );
      }
      if (!config.relayToken) {
        throw new GitlabApiError(
          "QNote GitLab Relay 令牌尚未初始化，请重新保存网关配置",
          0,
          false
        );
      }

      const gitlab = getGitlabConfig();
      if (!gitlab.baseUrl) {
        throw new GitlabApiError("没配 GitLab 实例地址", 0, false);
      }

      const info = await resolveProjectId(project);
      const ref = (input.ref || "").trim() || info.defaultBranch;
      const triggerToken = await findOrCreateTrigger(project, ref);
      const webhookUrl = buildTriggerApiUrl({
        baseUrl: gitlab.baseUrl,
        projectId: info.id,
        ref,
        token: triggerToken,
      });
      const ciTemplate = buildCiTemplate({
        relayUrl: relayEndpoint(config.port),
        relayToken: config.relayToken,
        projectPath: info.path,
        tags: config.runnerTags,
      });

      if (input.dry_run) {
        return {
          dry_run: true,
          project: info.path,
          project_id: info.id,
          ref,
          trigger_api_url: webhookUrl,
          ci_template: ciTemplate,
          note: "演练模式：没有真的建 trigger token 或 webhook",
        };
      }

      const hook = await upsertHook(
        project,
        webhookUrl,
        HOOK_EVENTS,
        TRIGGER_POINTER_TEMPLATE
      );
      await ensureCiVariables(project, config.relayToken);

      return {
        project: info.path,
        project_id: info.id,
        ref,
        trigger_api_url: webhookUrl,
        webhook: { id: hook.hook.id, url: hook.hook.url, action: hook.action },
        ci_variables: {
          QNOTE_RELAY_URL: relayEndpoint(config.port),
          QNOTE_RELAY_TOKEN: "已写入（已掩码）",
        },
        ci_template: ciTemplate,
        next_step:
          "把 ci_template 的内容作为 .gitlab-ci.yml 提交到仓库（main 分支），" +
          "并确认自托管 Runner 已注册到该项目",
      };
    });
  },
  {
    name: "gitlab_ensure_runner",
    description:
      "给项目配置 Runner 接入：建 pipeline trigger token、把 Webhook 指向 GitLab 自己的 trigger API、" +
      "写入 relay 所需的 CI 变量，并返回要提交到仓库的 .gitlab-ci.yml 模板。" +
      "写操作，会改项目上的 Webhook 与 CI 变量。",
    schema: strictObject({
      project: projectSchema.describe("项目路径或数字项目 ID"),
      ref: z.string().trim().min(1).optional().describe("触发流水线用的分支，默认项目默认分支"),
      dry_run: z.boolean().optional(),
    }),
  }
);

async function findOrCreateTrigger(
  project: string,
  ref: string
): Promise<string> {
  const triggers = await listTriggers(project);
  const existing = triggers.find(
    (item) => item.description === GITLAB_TRIGGER_DESCRIPTION
  );
  if (existing?.token) return existing.token;
  const created = await createTrigger(project, GITLAB_TRIGGER_DESCRIPTION, ref);
  if (!created?.token) {
    throw new GitlabApiError("创建 pipeline trigger 没拿到令牌", 0, false);
  }
  return created.token;
}

async function ensureCiVariables(
  project: string,
  relayToken: string
): Promise<void> {
  const url = relayEndpoint(getGitlabBotConfig().port);
  await upsertVariable(project, "QNOTE_RELAY_URL", url, false);
  await upsertVariable(project, "QNOTE_RELAY_TOKEN", relayToken, true);
}

async function upsertVariable(
  project: string,
  key: string,
  value: string,
  masked: boolean
): Promise<void> {
  const existing = await listVariables(project);
  const hit = existing.find((item) => item.key === key);
  const body = { key, value, masked, protected: false, raw: true };
  if (hit) {
    await updateVariable(project, key, value, masked);
    return;
  }
  await createVariable(project, body);
}

async function listVariables(
  project: string
): Promise<Array<{ key: string; value: string; masked: boolean }>> {
  const result = await gitlabRequest<
    Array<{ key: string; value: string; masked: boolean }>
  >({
    method: "GET",
    path: gitlabEndpoints.variables(project),
    idempotent: true,
  });
  return Array.isArray(result.data) ? result.data : [];
}

async function createVariable(
  project: string,
  body: Record<string, unknown>
): Promise<void> {
  await gitlabRequest({
    method: "POST",
    path: gitlabEndpoints.variables(project),
    body,
  });
}

async function updateVariable(
  project: string,
  key: string,
  value: string,
  masked: boolean
): Promise<void> {
  await gitlabRequest({
    method: "PUT",
    path: gitlabEndpoints.variable(project, key),
    body: { value, masked, protected: false, raw: true },
  });
}
