import { ipcMain } from "electron";
import { log } from "../../core/system/log";
import {
  applyGitlabBotConfig,
  getGitlabBotConfig,
  getGitlabBotStatus,
  getGitlabRunnerStatus,
  resetGitlabBotConfig,
  startGitlabRunner,
  stopGitlabRunner,
} from "../../core/ai/gitlabBot";
import { generateSigningToken } from "../../core/ai/gitlabBot/signature";
import { generateRelayToken } from "../../core/ai/gitlabBot/relay";
import type { GitlabBotConfigPayload } from "../../../shared/ai/gitlabBot";

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "*".repeat(token.length);
  return `${token.slice(0, 4)}******${token.slice(-4)}`;
}

export function registerGitlabBotHandlers(DB: any): void {
  ipcMain.handle("gitlab-bot:get-config", async () => {
    const config = getGitlabBotConfig();
    return {
      success: true,
      config: {
        enabled: config.enabled,
        port: config.port,
        bindAddress: config.bindAddress,
        signingTokenHint: maskToken(config.signingToken),
        secretTokenHint: maskToken(config.secretToken),
        relayTokenHint: maskToken(config.relayToken),
        triggerWords: config.triggerWords,
        allowedProjects: config.allowedProjects,
        runnerEnabled: config.runnerEnabled,
        runnerProject: config.runnerProject,
        runnerTags: config.runnerTags,
      },
      status: getGitlabBotStatus(),
      runner: getGitlabRunnerStatus(),
    };
  });

  ipcMain.handle(
    "gitlab-bot:save-config",
    async (_event, payload: GitlabBotConfigPayload) => {
      const patch: Record<string, unknown> = {};
      if (typeof payload?.enabled === "boolean") patch.enabled = payload.enabled;
      if (Number.isFinite(Number(payload?.port))) {
        patch.port = Number(payload.port);
      }
      if (
        typeof payload?.bindAddress === "string" &&
        payload.bindAddress.trim()
      ) {
        patch.bindAddress = payload.bindAddress.trim();
      }
      if (
        typeof payload?.signingToken === "string" &&
        payload.signingToken.trim()
      ) {
        patch.signingToken = payload.signingToken.trim();
      }
      if (
        typeof payload?.secretToken === "string" &&
        payload.secretToken.trim()
      ) {
        patch.secretToken = payload.secretToken.trim();
      }
      if (
        typeof payload?.relayToken === "string" &&
        payload.relayToken.trim()
      ) {
        patch.relayToken = payload.relayToken.trim();
      }
      if (Array.isArray(payload?.triggerWords)) {
        patch.triggerWords = payload.triggerWords;
      }
      if (Array.isArray(payload?.allowedProjects)) {
        patch.allowedProjects = payload.allowedProjects;
      }
      if (typeof payload?.runnerEnabled === "boolean") {
        patch.runnerEnabled = payload.runnerEnabled;
      }
      if (typeof payload?.runnerProject === "string") {
        patch.runnerProject = payload.runnerProject.trim();
      }
      if (Array.isArray(payload?.runnerTags)) {
        patch.runnerTags = payload.runnerTags;
      }

      try {
        await applyGitlabBotConfig(patch, DB);
        return { success: true, status: getGitlabBotStatus() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("[gitlab-bot] 保存配置失败", err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle("gitlab-bot:generate-secret", async () => {
    try {
      return { success: true, secret: generateSigningToken() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[gitlab-bot] 生成签名密钥失败", err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("gitlab-bot:generate-relay-token", async () => {
    try {
      return { success: true, token: generateRelayToken() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[gitlab-bot] 生成 relay 令牌失败", err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("gitlab-bot:reveal-relay-token", async () => {
    const config = getGitlabBotConfig();
    return { success: true, token: config.relayToken };
  });

  ipcMain.handle("gitlab-bot:runner-status", async () => {
    return { success: true, runner: getGitlabRunnerStatus() };
  });

  ipcMain.handle("gitlab-bot:restart-runner", async () => {
    try {
      await stopGitlabRunner();
      await startGitlabRunner();
      return { success: true, runner: getGitlabRunnerStatus() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[gitlab-bot] 重启 runner 失败", err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("gitlab-bot:clear-config", async () => {
    try {
      await resetGitlabBotConfig(DB);
      return { success: true, status: getGitlabBotStatus() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[gitlab-bot] 清除配置失败", err);
      return { success: false, error: message };
    }
  });
}
