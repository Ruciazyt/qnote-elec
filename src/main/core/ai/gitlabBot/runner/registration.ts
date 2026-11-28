import { spawn, type ChildProcess } from "node:child_process";
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
import { writeRunnerBinding } from "./binding";
import { resolveRunnerTags } from "../../../../../shared/ai/gitlabBot";

export const RUNNER_DESCRIPTION = "qnote-local";
const REGISTER_TIMEOUT_MS = 60_000;

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

  const tags = resolveRunnerTags(options.tags);

  let registration: {
    runnerId: number;
    token: string;
    action: "created" | "reset";
  };
  try {
    registration = await registerWithGitLab(options.project, tags);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await registerLocally({
      binary,
      baseUrl: cfg.baseUrl,
      token: registration.token,
      configPath: runnerConfigPath(),
    });
  } catch (err) {
    removeLocalRunnerConfig();
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  writeRunnerBinding({ project: options.project, tags, url: cfg.baseUrl });
  log.info("[gitlab-bot] runner 注册完成", {
    runnerId: registration.runnerId,
    action: registration.action,
  });
  return { ok: true };
}

function removeLocalRunnerConfig(): void {
  try {
    fs.rmSync(runnerConfigPath(), { force: true });
  } catch (err) {
    log.warn("[gitlab-bot] 删除本地 runner 配置失败", err);
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
    let child: ChildProcess;
    try {
      child = spawn(options.binary, args, {
        cwd: dir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err instanceof Error ? err.message : String(err));
      return;
    }
    let output = "";
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      settle(() => reject(new Error("gitlab-runner register 超时")));
    }, REGISTER_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (err) => settle(() => reject(err)));
    child.on("close", (code) => {
      settle(() => {
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
  });
}
