import { ipcMain } from "electron";
import { configManager } from "../utils/config";
import { setBaiduKeys } from "../utils/baiduOCR";
import { log } from "../utils/log";
import { app } from "electron";
import * as https from "https";

/** GitHub 仓库信息 — 用于检查更新 */
const GITHUB_OWNER = "Ruciazyt";
const GITHUB_REPO = "qnote-elec";
/** 请求超时时间（毫秒） */
const RELEASE_FETCH_TIMEOUT_MS = 15000;

interface GithubReleasePayload {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/**
 * 通过 GitHub Releases API 查询最新版本
 * 文档：https://docs.github.com/en/rest/releases/releases#get-the-latest-release
 */
function fetchLatestRelease(): Promise<{
  success: boolean;
  tag?: string;
  version?: string;
  name?: string;
  htmlUrl?: string;
  publishedAt?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "QNote-Electron",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 404) {
            // 仓库还没有任何 release
            log.info("GitHub 上尚未发布 release");
            resolve({ success: false, error: "暂无可用更新" });
            return;
          }
          if (res.statusCode !== 200) {
            log.warn(`查询最新版本失败: HTTP ${res.statusCode}`, data);
            resolve({
              success: false,
              error: `GitHub 返回 ${res.statusCode}`,
            });
            return;
          }
          try {
            const release = JSON.parse(data) as GithubReleasePayload;
            const tagName = release.tag_name || "";
            // 去掉 tag 前缀的 "v" 或 "V"
            const version = tagName.replace(/^[vV]/, "");
            resolve({
              success: true,
              tag: tagName,
              version,
              name: release.name || tagName,
              htmlUrl: release.html_url,
              publishedAt: release.published_at,
            });
          } catch (parseErr) {
            log.error("解析 release JSON 失败", parseErr);
            resolve({ success: false, error: "响应解析失败" });
          }
        });
      }
    );
    req.on("error", (err) => {
      log.error("查询最新版本网络错误", err);
      resolve({
        success: false,
        error: err.message || "网络错误",
      });
    });
    req.setTimeout(RELEASE_FETCH_TIMEOUT_MS, () => {
      log.warn("查询最新版本超时");
      req.destroy();
      resolve({ success: false, error: "请求超时" });
    });
  });
}

export function registerConfigHandlers() {
  ipcMain.handle("get-baidu-keys", async () => {
    return configManager.getBaiduKeys();
  });

  ipcMain.handle("set-baidu-keys", async (_event, apiKey: string, secretKey: string) => {
    try {
      await configManager.setBaiduKeys(apiKey, secretKey);
      setBaiduKeys(apiKey, secretKey);
      log.info("百度OCR密钥已更新");
      return { success: true };
    } catch (error) {
      log.error("设置百度OCR密钥失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("get-app-info", async () => {
    try {
      return {
        productName: app.getName(),
        dataPath: configManager.getDataPath(),
        configPath: configManager.getConfigPath(),
        version: app.getVersion(),
        appPath: app.getAppPath(),
        exePath: app.getPath('exe')
      };
    } catch (error) {
      log.error("获取应用信息失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 查询 GitHub Releases 上的最新版本
   * 与 get-app-info 一起被设置页面调用，用于"检查更新"功能
   */
  ipcMain.handle("get-latest-release", async () => {
    try {
      return await fetchLatestRelease();
    } catch (err) {
      log.error("检查更新失败", err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

