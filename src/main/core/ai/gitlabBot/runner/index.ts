import * as fs from "node:fs";
import { log } from "../../../system/log";
import type { GitlabRunnerStatusView } from "../../../../../shared/ai/gitlabBot";
import { getGitlabBotConfig } from "../configStore";
import { runnerConfigIsUsable } from "./configFile";
import { runnerConfigPath, resolveRunnerBinary } from "./paths";
import { GitlabRunnerProcess } from "./process";
import { ensureRunnerRegistered } from "./registration";

const runner = new GitlabRunnerProcess();
let lastError = "";
let repairing = false;

runner.onUnexpectedExit = (info) => {
  if (!info.early) return;
  void repairRegistration();
};

function runnerProject(): string {
  const config = getGitlabBotConfig();
  return config.runnerProject || config.allowedProjects[0] || "";
}

async function repairRegistration(): Promise<void> {
  if (repairing) return;
  repairing = true;
  runner.cancelRestart();
  try {
    const project = runnerProject();
    if (!project) {
      lastError = "runner 启动后立刻退出，且没指定绑定的项目";
      log.warn("[gitlab-bot] " + lastError);
      return;
    }
    log.warn("[gitlab-bot] runner 启动后立刻退出，重新注册一次");
    const config = getGitlabBotConfig();
    const result = await ensureRunnerRegistered({
      project,
      tags: config.runnerTags,
    });
    if (!result.ok) {
      lastError = result.error ?? "重新注册失败";
      log.error("[gitlab-bot] " + lastError);
      return;
    }
    lastError = "";
    runner.start();
  } finally {
    repairing = false;
  }
}

export async function startGitlabRunner(): Promise<GitlabRunnerStatusView> {
  const config = getGitlabBotConfig();
  if (!config.runnerEnabled) {
    return getGitlabRunnerStatus();
  }

  const binary = resolveRunnerBinary();
  if (!binary) {
    lastError = "找不到 gitlab-runner 可执行文件";
    log.warn("[gitlab-bot] " + lastError + "，跳过 runner 启动");
    return getGitlabRunnerStatus();
  }

  const configPath = runnerConfigPath();
  let registered = false;
  if (fs.existsSync(configPath)) {
    try {
      registered = runnerConfigIsUsable(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      log.error("[gitlab-bot] 读 runner 配置失败", err);
    }
  }

  if (!registered) {
    const project = runnerProject();
    if (!project) {
      lastError = "runner 还没注册，且没指定绑定的项目";
      log.warn("[gitlab-bot] " + lastError);
      return getGitlabRunnerStatus();
    }
    const result = await ensureRunnerRegistered({
      project,
      tags: config.runnerTags,
    });
    if (!result.ok) {
      lastError = result.error ?? "runner 注册失败";
      log.error("[gitlab-bot] " + lastError);
      return getGitlabRunnerStatus();
    }
    lastError = "";
  }

  const started = runner.start();
  if (!started.ok) {
    lastError = started.error ?? "runner 启动失败";
  }
  return getGitlabRunnerStatus();
}

export async function stopGitlabRunner(): Promise<void> {
  runner.cancelRestart();
  await runner.stop();
}

export function getGitlabRunnerStatus(): GitlabRunnerStatusView {
  const config = getGitlabBotConfig();
  const status = runner.status();
  return {
    running: status.running,
    pid: status.pid,
    enabled: config.runnerEnabled,
    project: runnerProject(),
    tags: config.runnerTags,
    binaryPath: status.binaryPath,
    configPath: status.configPath,
    restarts: status.restarts,
    lastError: status.lastError || lastError,
  };
}
