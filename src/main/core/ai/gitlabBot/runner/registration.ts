import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../../../system/log";
import { resolveProjectId } from "../../tools/gitlab/api/projects";
import {
  createProjectRunner,
  listProjectRunners,
  resetRunnerAuthToken,
  updateRunner,
} from "../../tools/gitlab/api/runnerApi";
import { getGitlabConfig } from "../../tools/gitlab/runtime/config";
import { runnerConfigPath, resolveRunnerBinary } from "./paths";
import { runnerShell } from "./shell";

export const RUNNER_DESCRIPTION = "qnote-local";

export interface EnsureRunnerOptions {
  project: string;
  tags: string[];
}

export type EnsureRunnerResult =
  | { ok: true }
  | { ok: false; error: string };

export async function ensureRunnerRegistered(
  options: EnsureRunnerOptions
): Promise<EnsureRunnerResult> {
  const cfg = getGitlabConfig();
  if (!cfg.baseUrl || !cfg.token) {
    return { ok: false, error: "没配 GitLab 实例地址或访问令牌" };
  }

  const binary = resolveRunnerBinary();
  if (!binary) {
    return { ok: false, error: "找不到 gitlab-runner 可执行文件" };
  }

  const tags = options.tags.length ? options.tags : [RUNNER_DESCRIPTION];

  try {
    const registration = await registerWithGitLab(options.project, tags);

    await registerLocally({
      binary,
      baseUrl: cfg.baseUrl,
      token: registration.token,
      configPath: runnerConfigPath(),
    });
    log.info("[gitlab-bot] runner 注册完成", {
      runnerId: registration.runnerId,
      action: registration.action,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function registerWithGitLab(
  project: string,
  tags: string[]
): Promise<{ runnerId: number; token: string; action: "created" | "reset" }> {
  const projectId = (await resolveProjectId(project)).id;
  const runners = await listProjectRunners(String(projectId));
  const existing = runners.find(
    (item) => item.description === RUNNER_DESCRIPTION
  );

  if (existing) {
    await updateRunner(existing.id, {
      description: RUNNER_DESCRIPTION,
      tag_list: tags,
      run_untagged: false,
      locked: true,
    });
    const token = (await resetRunnerAuthToken(existing.id)).token;
    if (!token) throw new Error("GitLab 没返回 runner 认证令牌");
    return { runnerId: existing.id, token, action: "reset" };
  }

  const auth = await createProjectRunner(projectId, {
    description: RUNNER_DESCRIPTION,
    tagList: tags,
  });
  if (!auth.id) throw new Error("GitLab 没返回 runner ID");
  if (!auth.token) throw new Error("GitLab 没返回 runner 认证令牌");
  return { runnerId: auth.id, token: auth.token, action: "created" };
}

function registerLocally(options: {
  binary: string;
  baseUrl: string;
  token: string;
  configPath: string;
}): Promise<void> {
  const dir = path.dirname(options.configPath);
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    "register",
    "--non-interactive",
    "--config",
    options.configPath,
    "--url",
    options.baseUrl,
    "--token",
    options.token,
    "--executor",
    "shell",
    "--shell",
    runnerShell(),
    "--name",
    RUNNER_DESCRIPTION,
  ];
  return new Promise<void>((resolve, reject) => {
    const child = spawn(options.binary, args, {
      cwd: dir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          "gitlab-runner register 退出码 " +
            String(code) +
            "：" +
            output.trim().slice(0, 500)
        )
      );
    });
  });
}
