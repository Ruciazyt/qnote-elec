import { ipcMain } from "electron";
import { log } from "../../core/system/log";

export interface BookmarkRow {
  id: number;
  title: string | null;
  url: string;
  created_at: string;
  updated_at: string;
}

function isBookmarkableUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
      return `${parsed.origin}/`;
    }
  } catch {
  }
  return trimmed;
}

export function registerBookmarkHandlers(DB: any) {
  ipcMain.handle("bookmark:list", async () => {
    try {
      const rows = await DB("browser_bookmark").select("*").orderBy("created_at", "desc");
      return rows as BookmarkRow[];
    } catch (err) {
      log.error("bookmark:list error:", err);
      return [];
    }
  });

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

  ipcMain.handle("bookmark:delete", async (_event, id: number): Promise<boolean> => {
    try {
      await DB("browser_bookmark").where("id", id).delete();
      return true;
    } catch (err) {
      log.error("bookmark:delete error:", err);
      return false;
    }
  });

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
