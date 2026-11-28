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
import type { GitlabBotConfigPayload } from "../../../shared/ai/gitlabBot";

export function registerGitlabBotHandlers(DB: any): void {
  ipcMain.handle("gitlab-bot:get-config", async () => {
    const config = getGitlabBotConfig();
    return {
      success: true,
      config: {
        enabled: config.enabled,
        triggerWords: config.triggerWords,
        allowedProjects: config.allowedProjects,
        runnerEnabled: config.runnerEnabled,
        runnerProject: config.runnerProject,
      },
      status: getGitlabBotStatus(),
      runner: getGitlabRunnerStatus(),
    };
  });

  ipcMain.handle(
    "gitlab-bot:save-config",
    async (_event, payload: GitlabBotConfigPayload) => {
      const patch = { ...payload };
      if (patch.triggerWords?.length === 0) patch.triggerWords = ["@qnote"];

      try {
        const applied = await applyGitlabBotConfig(patch, DB);
        return {
          success: true,
          status: getGitlabBotStatus(),
          error: applied.error,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("[gitlab-bot] 保存配置失败", err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle("gitlab-bot:runner-status", async () => {
    return { success: true, runner: getGitlabRunnerStatus() };
  });

  ipcMain.handle("gitlab-bot:restart-runner", async () => {
    try {
      await stopGitlabRunner();
      const runner = await startGitlabRunner();
      const started = !runner.enabled || runner.running;
      return {
        success: started,
        runner,
        error: started ? "" : runner.lastError || "Runner 没起来",
      };
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
