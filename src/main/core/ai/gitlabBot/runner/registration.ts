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
  description?: string;
}

export interface EnsureRunnerResult {
  ok: boolean;
  runnerId: number;
  action: "created" | "reset";
  error?: string;
}

export async function ensureRunnerRegistered(
  options: EnsureRunnerOptions
): Promise<EnsureRunnerResult> {
  const cfg = getGitlabConfig();
  if (!cfg.baseUrl || !cfg.token) {
    return {
      ok: false,
      runnerId: 0,
      action: "created",
      error: "没配 GitLab 实例地址或访问令牌",
    };
  }

  const binary = resolveRunnerBinary();
  if (!binary) {
    return {
      ok: false,
      runnerId: 0,
      action: "created",
      error: "找不到 gitlab-runner 可执行文件",
    };
  }

  const description = options.description?.trim() || RUNNER_DESCRIPTION;
  const tags = options.tags.length ? options.tags : [RUNNER_DESCRIPTION];

  let projectId = 0;
  try {
    projectId = (await resolveProjectId(options.project)).id;
  } catch (err) {
    return {
      ok: false,
      runnerId: 0,
      action: "created",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let runnerId = 0;
  let token = "";
  let action: "created" | "reset" = "created";
  try {
    const runners = await listProjectRunners(String(projectId));
    const existing = runners.find((item) => item.description === description);
    if (existing) {
      runnerId = existing.id;
      await updateRunner(runnerId, {
        description,
        tag_list: tags,
        run_untagged: false,
        locked: true,
      });
      const auth = await resetRunnerAuthToken(runnerId);
      token = auth.token;
      action = "reset";
    } else {
      const auth = await createProjectRunner(projectId, {
        description,
        tagList: tags,
      });
      runnerId = auth.id ?? 0;
      token = auth.token;
    }
  } catch (err) {
    return {
      ok: false,
      runnerId,
      action,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!token) {
    return { ok: false, runnerId, action, error: "GitLab 没返回 runner 认证令牌" };
  }

  try {
    await registerLocally({
      binary,
      baseUrl: cfg.baseUrl,
      token,
      name: description,
      configPath: runnerConfigPath(),
    });
  } catch (err) {
    return {
      ok: false,
      runnerId,
      action,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  log.info("[gitlab-bot] runner 注册完成", { runnerId, action, description });
  return { ok: true, runnerId, action };
}

function registerLocally(options: {
  binary: string;
  baseUrl: string;
  token: string;
  name: string;
  configPath: string;
}): Promise<string> {
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
    options.name,
  ];
  return new Promise<string>((resolve, reject) => {
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
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(output);
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
