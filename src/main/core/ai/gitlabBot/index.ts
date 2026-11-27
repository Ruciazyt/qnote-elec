import { log } from "../../system/log";
import {
  clearGitlabBotConfig,
  getGitlabBotConfig,
  initGitlabBotConfigStore,
  saveGitlabBotConfig,
  type GitlabBotConfig,
} from "./configStore";
import { GitlabBotServer } from "./server";
import { GitlabBotTrigger } from "./trigger";
import {
  startGitlabRunner,
  stopGitlabRunner,
} from "./runner";
import { setGitlabTriggerWords } from "../tools/gitlab/runtime/triggerWords";
import type { GitlabBotStatus } from "../../../../shared/ai/gitlabBot";

let server: GitlabBotServer | null = null;

export function getGitlabBotStatus(): GitlabBotStatus {
  const config = getGitlabBotConfig();
  const port = server?.currentPort ?? 0;
  return {
    running: server?.running ?? false,
    port,
    url: port ? `http://${config.bindAddress}:${port}` : "",
  };
}

export async function startGitlabBotServer(DB: any): Promise<void> {
  await stopGitlabBotServer();
  const config = getGitlabBotConfig();
  if (!config.enabled) {
    log.info("[gitlab-bot] 网关未启用");
    return;
  }
  if (!config.signingToken && !config.secretToken && !config.relayToken) {
    log.warn("[gitlab-bot] 没配 webhook 密钥，网关不启动");
    return;
  }
  const trigger = new GitlabBotTrigger(DB);
  const instance = new GitlabBotServer(trigger);
  try {
    const endpoint = await instance.start();
    server = instance;
    log.info("[gitlab-bot] 网关已启动", {
      url: endpoint.url,
      port: endpoint.port,
    });
  } catch (err) {
    log.error("[gitlab-bot] 网关启动失败", err);
  }
}

export async function stopGitlabBotServer(): Promise<void> {
  if (!server) return;
  await server.stop();
  server = null;
}

export async function initGitlabBot(DB: any): Promise<void> {
  await initGitlabBotConfigStore(DB);
  setGitlabTriggerWords(getGitlabBotConfig().triggerWords);
  await startGitlabBotServer(DB);
  await startGitlabRunner();
}

async function syncGitlabRunner(): Promise<void> {
  if (getGitlabBotConfig().runnerEnabled) {
    await startGitlabRunner();
    return;
  }
  await stopGitlabRunner();
}

export async function applyGitlabBotConfig(
  patch: Partial<GitlabBotConfig>,
  DB: any
): Promise<GitlabBotConfig> {
  const next = await saveGitlabBotConfig(patch);
  setGitlabTriggerWords(next.triggerWords);
  await startGitlabBotServer(DB);
  await syncGitlabRunner();
  return next;
}

export async function resetGitlabBotConfig(DB: any): Promise<void> {
  await stopGitlabBotServer();
  await clearGitlabBotConfig();
  setGitlabTriggerWords(getGitlabBotConfig().triggerWords);
  await startGitlabBotServer(DB);
}

export { getGitlabBotConfig };
export { startGitlabRunner, stopGitlabRunner };
export { getGitlabRunnerStatus } from "./runner";
