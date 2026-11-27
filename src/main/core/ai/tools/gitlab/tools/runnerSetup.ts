import { detectRunnerShell } from "../../../gitlabBot/runner/shell";
import { gitlabRequest } from "../api/client";
import { gitlabEndpoints } from "../api/endpoints";
import type { GitlabHook, GitlabPipelineTrigger } from "../api/types";

export { resolveProjectId } from "../api/projects";

export const GITLAB_TRIGGER_DESCRIPTION = "qnote-bot";

export interface RunnerSetupPlan {
  baseUrl: string;
  projectId: number;
  projectPath: string;
  ref: string;
  triggerId: number | null;
  triggerToken: string;
  webhookUrl: string;
  ciTemplate: string;
}

function trimBase(baseUrl: string): string {
  let out = baseUrl.trim();
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

export function buildTriggerApiUrl(options: {
  baseUrl: string;
  projectId: number;
  ref: string;
  token: string;
}): string {
  const base = trimBase(options.baseUrl);
  const ref = encodeURIComponent(options.ref);
  return (
    base +
    "/api/v4/projects/" +
    options.projectId +
    "/ref/" +
    ref +
    "/trigger/pipeline?token=" +
    encodeURIComponent(options.token)
  );
}

export type CiShell = "powershell" | "bash";

const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);

function bashBody(): string[] {
  return [
    "      curl --silent --show-error --fail --request POST --header " +
      DQ +
      "X-QNote-Relay-Token: $QNOTE_RELAY_TOKEN" +
      DQ +
      " --header " +
      DQ +
      "Content-Type: application/json" +
      DQ +
      " --header " +
      DQ +
      "X-QNote-Pipeline-Id: $CI_PIPELINE_ID" +
      DQ +
      " --header " +
      DQ +
      "X-QNote-Project-Id: $CI_PROJECT_ID" +
      DQ +
      " --data-binary " +
      DQ +
      "@$TRIGGER_PAYLOAD" +
      DQ +
      " " +
      DQ +
      "$QNOTE_RELAY_URL" +
      DQ,
  ];
}

function powershellBody(): string[] {
  return [
    "      curl.exe --silent --show-error --fail --request POST --header " +
      DQ +
      "X-QNote-Relay-Token: $env:QNOTE_RELAY_TOKEN" +
      DQ +
      " --header " +
      DQ +
      "Content-Type: application/json" +
      DQ +
      " --header " +
      DQ +
      "X-QNote-Pipeline-Id: $env:CI_PIPELINE_ID" +
      DQ +
      " --header " +
      DQ +
      "X-QNote-Project-Id: $env:CI_PROJECT_ID" +
      DQ +
      " --data-binary " +
      DQ +
      "@$env:TRIGGER_PAYLOAD" +
      DQ +
      " " +
      DQ +
      "$env:QNOTE_RELAY_URL" +
      DQ,
  ];
}

export function buildCiTemplate(options: {
  relayUrl: string;
  relayToken: string;
  projectPath: string;
  shell?: CiShell;
  tags?: string[];
}): string {
  const shell = options.shell ?? detectRunnerShell();
  const tags = options.tags?.length ? options.tags : ["qnote"];
  const lines = [
    "# QNote GitLab 机器人接入",
    "#",
    "# GitLab 侧的 webhook 指向本实例的 pipeline trigger API，",
    "# 事件触发后由自托管 Runner 领走这个 job，job 再把原始事件转给 QNote 网关。",
    "#",
    "# 需要配两个 CI/CD 变量：",
    "#   QNOTE_RELAY_URL    —— QNote 网关地址，形如 http://127.0.0.1:7799/gitlab/relay",
    "#   QNOTE_RELAY_TOKEN  —— QNote 网关的 relay 令牌",
    "#",
    "# job 把 runner 写好的事件指针文件直接 POST 给 QNote 网关，",
    "# QNote 按指针里的 id 回 GitLab 取原文。",
    "# $TRIGGER_PAYLOAD 是 file 类型变量：runner 写成文件后把文件路径放进环境",
    "# 变量，curl 用 --data-binary \"@路径\" 把文件内容原样发出去。",
    "# 别把内容读进 shell 变量再拼进命令行 —— 反引号与中文会把脚本段搞坏，",
    "# 连带 CI 变量全丢，job 直接跑不起来。",
    "# pipeline id 与项目 id 一起带上：万一指针为空，QNote 还能回源兜底。",
    "",
    "qnote-relay:",
    "  stage: build",
    "  tags:",
    ...tags.map((tag) => "    - " + tag),
    "  variables:",
    "    GIT_STRATEGY: none",
    "  rules:",
    "    - if: " +
      SQ +
      "$CI_PIPELINE_SOURCE == " +
      DQ +
      "trigger" +
      DQ +
      " && $TRIGGER_PAYLOAD" +
      SQ,
    "  script:",
    "    - |",
    ...(shell === "bash" ? bashBody() : powershellBody()),
    "",
  ];
  return lines.join("\n");
}


export async function listTriggers(
  project: string
): Promise<GitlabPipelineTrigger[]> {
  const result = await gitlabRequest<GitlabPipelineTrigger[]>({
    method: "GET",
    path: gitlabEndpoints.triggers(project),
    idempotent: true,
  });
  return Array.isArray(result.data) ? result.data : [];
}

export async function createTrigger(
  project: string,
  description: string,
  ref: string
): Promise<GitlabPipelineTrigger> {
  const result = await gitlabRequest<GitlabPipelineTrigger>({
    method: "POST",
    path: gitlabEndpoints.triggers(project),
    body: { description, ref },
  });
  return result.data;
}

export async function listHooks(project: string): Promise<GitlabHook[]> {
  const result = await gitlabRequest<GitlabHook[]>({
    method: "GET",
    path: gitlabEndpoints.hooks(project),
    idempotent: true,
  });
  return Array.isArray(result.data) ? result.data : [];
}

export async function upsertHook(
  project: string,
  url: string,
  events: Record<string, boolean>,
  customWebhookTemplate?: string
): Promise<{ action: "created" | "updated"; hook: GitlabHook }> {
  const existing = (await listHooks(project)).find((hook) => hook.url === url);
  const body: Record<string, unknown> = { url, ...events };
  if (customWebhookTemplate) {
    body.custom_webhook_template = customWebhookTemplate;
  }
  if (existing) {
    const result = await gitlabRequest<GitlabHook>({
      method: "PUT",
      path: gitlabEndpoints.hook(project, existing.id),
      body,
    });
    return { action: "updated", hook: result.data };
  }
  const result = await gitlabRequest<GitlabHook>({
    method: "POST",
    path: gitlabEndpoints.hooks(project),
    body,
  });
  return { action: "created", hook: result.data };
}
