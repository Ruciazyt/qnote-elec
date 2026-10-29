import { ipcMain } from "electron";
import { log } from "../utils/log";

export interface BookmarkRow {
  id: number;
  title: string | null;
  url: string;
  created_at: string;
  updated_at: string;
}

/** 只允许收藏 http/https，避免把内嵌视图打不开的协议存进来 */
function isBookmarkableUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

/**
 * 收藏 url（已存在则更新标题）
 * 用 URL 归一化后的字符串做去重依据 —— 同一页面带不同 hash 的情况按不同书签处理，
 * 这与浏览器"可分别收藏带锚点的链接"的习惯一致
 */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    // 去掉末尾多余斜杠，但保留根路径本身
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
      return `${parsed.origin}/`;
    }
  } catch {
    // URL 解析失败就原样返回，由后续校验拦截
  }
  return trimmed;
}

export function registerBookmarkHandlers(DB: any) {
  /** 书签列表 — 按收藏时间倒序 */
  ipcMain.handle("bookmark:list", async () => {
    try {
      const rows = await DB("browser_bookmark").select("*").orderBy("created_at", "desc");
      return rows as BookmarkRow[];
    } catch (err) {
      log.error("bookmark:list error:", err);
      return [];
    }
  });

  /** 当前 URL 是否已收藏 — 工具栏星星图标的状态来源 */
  ipcMain.handle("bookmark:is-saved", async (_event, url: string) => {
    try {
      if (!isBookmarkableUrl(url)) return false;
      const row = await DB("browser_bookmark")
        .where("url", normalizeUrl(url))
        .first();
      return !!row;
    } catch (err) {
      log.error("bookmark:is-saved error:", err);
      return false;
    }
  });

  /** 收藏当前页 — 重复收藏视为更新标题，不报错 */
  ipcMain.handle(
    "bookmark:add",
    async (_event, url: string, title?: string): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!isBookmarkableUrl(url)) {
          return { success: false, error: "只能收藏 http/https 页面" };
        }
        const normalized = normalizeUrl(url);
        const cleanTitle =
          typeof title === "string" && title.trim() ? title.trim() : normalized;

        const existing = await DB("browser_bookmark")
          .where("url", normalized)
          .first();

        if (existing) {
          // 已收藏 —— 更新标题让它跟随后续变化
          await DB("browser_bookmark").where("id", existing.id).update({
            title: cleanTitle,
            updated_at: new Date(),
          });
          return { success: true };
        }

        await DB("browser_bookmark").insert({
          title: cleanTitle,
          url: normalized,
          created_at: new Date(),
          updated_at: new Date(),
        });
        return { success: true };
      } catch (err) {
        log.error("bookmark:add error:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /** 取消收藏 — 按 URL 删，重复调用不报错 */
  ipcMain.handle(
    "bookmark:remove",
    async (_event, url: string): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!isBookmarkableUrl(url)) {
          return { success: false, error: "只能取消收藏 http/https 页面" };
        }
        await DB("browser_bookmark").where("url", normalizeUrl(url)).delete();
        return { success: true };
      } catch (err) {
        log.error("bookmark:remove error:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /** 删除单条收藏（按 id） */
  ipcMain.handle("bookmark:delete", async (_event, id: number): Promise<boolean> => {
    try {
      await DB("browser_bookmark").where("id", id).delete();
      return true;
    } catch (err) {
      log.error("bookmark:delete error:", err);
      return false;
    }
  });

  /** 清空全部收藏 */
  ipcMain.handle("bookmark:clear", async (): Promise<boolean> => {
    try {
      await DB("browser_bookmark").del();
      return true;
    } catch (err) {
      log.error("bookmark:clear error:", err);
      return false;
    }
  });

  log.info("浏览器收藏 IPC 处理器已注册");
}
