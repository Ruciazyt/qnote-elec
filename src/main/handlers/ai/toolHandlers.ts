import { ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../../core/system/log";
import { listBuiltinTools } from "../../core/ai/tools/catalog";
import { getGitlabConfig } from "../../core/ai/tools/gitlab/runtime/config";
import {
  clearGitlabConfig,
  loadGitlabConfig,
  saveGitlabConfig,
} from "../../core/ai/tools/gitlab/runtime/configStore";
import { getGithubConfig } from "../../core/ai/tools/github/runtime/config";
import {
  clearGithubConfig,
  loadGithubConfig,
  saveGithubConfig,
} from "../../core/ai/tools/github/runtime/configStore";
import { isToolEnabled, setToolEnabled } from "../../core/ai/tools/toolToggle";
import type {
  BuiltinToolState,
  GithubToolConfig,
  GithubToolConfigInput,
  GitlabToolConfig,
  GitlabToolConfigInput,
} from "../../../shared/ai/tools";

function gitlabConfig() {
  try {
    return getGitlabConfig();
  } catch (err) {
    log.error("[tools] 读取 GitLab 配置失败", err);
    return { baseUrl: "", token: "", allowedProjects: [], readOnly: false, expectedVersion: null, maxResultTokens: 4000, requestTimeoutMs: 30000 };
  }
}

function githubConfig() {
  try {
    return getGithubConfig();
  } catch (err) {
    log.error("[tools] 读取 GitHub 配置失败", err);
    return { baseUrl: "", token: "", allowedRepositories: [], readOnly: false, maxResultTokens: 4000, requestTimeoutMs: 30000 };
  }
}

function tokenHint(token: string): string {
  if (!token) return "";
  return token.length > 4 ? "••••" + token.slice(-4) : "••••";
}

export function registerToolHandlers() {
  ipcMain.handle("ai-list-builtin-tools", async (): Promise<BuiltinToolState[]> => {
    const cfg = gitlabConfig();
    const configured = cfg.baseUrl.length > 0 && cfg.token.length > 0;
    const ghCfg = githubConfig();
    const ghConfigured = ghCfg.baseUrl.length > 0 && ghCfg.token.length > 0;
    return listBuiltinTools().map((tool) => {
      let note: string | undefined;
      if (tool.group === "GitLab") {
        if (!configured) note = "未配置";
        else if (cfg.readOnly && tool.kind === "write") note = "只读模式";
      } else if (tool.group === "GitHub") {
        if (!ghConfigured) note = "未配置";
        else if (ghCfg.readOnly && tool.kind === "write") note = "只读模式";
      }
      return { ...tool, enabled: isToolEnabled(tool.name), note };
    });
  });

  ipcMain.handle(
    "ai-set-builtin-tool-enabled",
    async (_event: IpcMainInvokeEvent, name: string, enabled: boolean) => {
      try {
        await setToolEnabled(name, enabled);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("[tools] 切换工具状态失败", err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle("ai-get-gitlab-config", async (): Promise<GitlabToolConfig> => {
    const cfg = gitlabConfig();
    const stored = await loadGitlabConfig();
    const baseUrl = stored?.baseUrl ?? cfg.baseUrl;
    const token = stored?.token || cfg.token;
    return {
      baseUrl,
      allowedProjects: stored?.allowedProjects ?? cfg.allowedProjects,
      readOnly: stored?.readOnly ?? cfg.readOnly,
      expectedVersion: stored?.expectedVersion ?? cfg.expectedVersion,
      hasToken: token.length > 0,
      tokenHint: tokenHint(token),
      configured: baseUrl.length > 0 && token.length > 0,
    };
  });

  ipcMain.handle(
    "ai-save-gitlab-config",
    async (_event: IpcMainInvokeEvent, input: GitlabToolConfigInput) => {
      try {
        let baseUrl = (input.baseUrl || "").trim();
        while (baseUrl.endsWith("/")) {
          baseUrl = baseUrl.slice(0, -1);
        }
        if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
          return { success: false, error: "实例地址必须以 http:// 或 https:// 开头" };
        }
        const current = gitlabConfig();
        const token = (input.token || "").trim() || current.token;
        const config = {
          baseUrl,
          token,
          allowedProjects: (input.allowedProjects || []).filter((item) => item.trim().length > 0),
          readOnly: input.readOnly === true,
          expectedVersion: (input.expectedVersion || "").trim() || null,
        };
        await saveGitlabConfig(config);
        log.info("[gitlab] 配置已保存", { baseUrl, readOnly: config.readOnly });
        return { success: true, hasToken: token.length > 0 };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("[gitlab] 保存配置失败", err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle("ai-clear-gitlab-config", async () => {
    try {
      await clearGitlabConfig();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[gitlab] 清除配置失败", err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle("ai-get-github-config", async (): Promise<GithubToolConfig> => {
    const cfg = githubConfig();
    const stored = await loadGithubConfig();
    const baseUrl = stored?.baseUrl ?? cfg.baseUrl;
    const token = stored?.token || cfg.token;
    return {
      baseUrl,
      allowedRepositories: stored?.allowedRepositories ?? cfg.allowedRepositories,
      readOnly: stored?.readOnly ?? cfg.readOnly,
      hasToken: token.length > 0,
      tokenHint: tokenHint(token),
      configured: baseUrl.length > 0 && token.length > 0,
    };
  });

  ipcMain.handle(
    "ai-save-github-config",
    async (_event: IpcMainInvokeEvent, input: GithubToolConfigInput) => {
      try {
        let baseUrl = (input.baseUrl || "").trim();
        while (baseUrl.endsWith("/")) {
          baseUrl = baseUrl.slice(0, -1);
        }
        if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
          return { success: false, error: "实例地址必须以 http:// 或 https:// 开头" };
        }
        const current = githubConfig();
        const token = (input.token || "").trim() || current.token;
        const config = {
          baseUrl,
          token,
          allowedRepositories: (input.allowedRepositories || []).filter((item) => item.trim().length > 0),
          readOnly: input.readOnly === true,
        };
        await saveGithubConfig(config);
        log.info("[github] 配置已保存", { baseUrl, readOnly: config.readOnly });
        return { success: true, hasToken: token.length > 0 };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("[github] 保存配置失败", err);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle("ai-clear-github-config", async () => {
    try {
      await clearGithubConfig();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[github] 清除配置失败", err);
      return { success: false, error: message };
    }
  });
}
