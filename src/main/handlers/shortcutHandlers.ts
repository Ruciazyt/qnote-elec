import { ipcMain, dialog, shell, app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../utils/log";
import { describeDBError } from "../../database";
import { getMainWindow } from "../core/window";
import { resolveShortcutIcon, type ShortcutKind } from "../utils/shortcutIcons";
import { getContextMenuStatus, setContextMenuEnabled, repairContextMenu } from "../utils/shellContextMenu";

export interface ShortcutRow {
  id: number;
  kind: ShortcutKind;
  target: string;
  title: string;
  sort_order: number;
}

export interface ShortcutInput {
  kind: ShortcutKind;
  target: string;
  title?: string;
}

export interface ShortcutPickResult {
  kind: ShortcutKind;
  target: string;
  title: string;
}

const KINDS: ReadonlySet<string> = new Set(["url", "app", "folder"]);

/** 本地程序允许的扩展名。.lnk 会被图标提取环节解到真实目标 */
const APP_EXTENSIONS = [".exe", ".lnk", ".bat", ".cmd"];

/**
 * 归一化 kind
 *
 * 渲染层和 `--add-shortcut` 命令行都算不可信输入，kind 必须在这里
 * 收口 —— 否则一个拼错的 kind 会一路写进数据库，之后每次渲染都读到它。
 */
function coerceKind(value: unknown): ShortcutKind | null {
  return typeof value === "string" && KINDS.has(value) ? (value as ShortcutKind) : null;
}

/**
 * 从一个路径/URL 推断快捷方式类型
 *
 * 用于「用户没告诉我们这是什么」的场合：系统右键菜单丢过来的是一条裸路径，
 * 拖进面板的也可能没带类型。判定顺序是先看是不是网址、再看是不是目录，
 * 剩下的都当本地程序 —— 一个不存在的路径也没必要拒绝，交给 openPath
 * 去报错并原样告诉用户，比在添加环节就拦下来更省事。
 */
export function inferShortcutKind(target: string): ShortcutKind {
  const trimmed = target.trim();
  if (/^https?:\/\//i.test(trimmed)) return "url";
  try {
    // 快捷方式目标本就是用户自己选的本地路径（系统右键菜单唤起、拖拽、多选），
    // 这里只做只读的存在性与类型探测 —— 不读内容也不写文件，没有「允许的父目录」
    // 可做包含性校验（SonarCloud S2083 路径穿越对这类探测不适用）
    if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) return "folder"; // NOSONAR
  } catch {
    /* stat 失败按文件处理 */
  }
  return "app";
}

/** 没有标题时按目标推导一个能一眼认出来的名字 */
function deriveTitle(kind: ShortcutKind, target: string): string {
  if (kind === "url") {
    try {
      return new URL(target).host.replace(/^www\./, "") || target;
    } catch {
      return target;
    }
  }
  const base = path.basename(target.trim()).replace(/\.(exe|lnk|bat|cmd)$/i, "");
  return base || target;
}

/**
 * 校验并归一化一条快捷方式
 *
 * 返回 null 表示不合法，调用方据此回错误信息。校验放在主进程是因为
 * 渲染层的校验只是为了即时反馈，这里才是唯一能信任的边界。
 */
function normalizeInput(input: ShortcutInput): ShortcutPickResult | { error: string } {
  const kind = coerceKind(input?.kind);
  if (!kind) return { error: "快捷方式类型不合法" };

  const target = (input?.target ?? "").trim();
  if (!target) return { error: "目标不能为空" };

  if (kind === "url") {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return { error: "网址格式不正确" };
    }
    // 只放行 http/https：javascript: 交给 shell.openExternal 未必被拦，
    // 而快捷方式本质是"点一下就跳走"，不能成为任意协议的执行入口
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "只支持 http / https 网址" };
    }
    const title = (input?.title ?? "").trim() || deriveTitle(kind, parsed.toString());
    return { kind, target: parsed.toString(), title };
  }

  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return { error: "路径不存在" };

  let isDir = false;
  try {
    // 同上：只读探测用户自己选的路径，不读内容也不写文件
    isDir = fs.statSync(abs).isDirectory(); // NOSONAR
  } catch {
    return { error: "无法读取该路径" };
  }

  if (kind === "folder" && !isDir) return { error: "这是一个文件，不是文件夹" };
  if (kind === "app" && isDir) return { error: "这是一个文件夹，请选择文件夹类型" };
  if (kind === "app" && !APP_EXTENSIONS.includes(path.extname(abs).toLowerCase())) {
    return { error: `只支持 ${APP_EXTENSIONS.join(" / ")} 类型的程序` };
  }

  const title = (input?.title ?? "").trim() || deriveTitle(kind, abs);
  return { kind, target: abs, title };
}

/** 目标是否已被收录。重名快捷方式没有任何意义，重复添加只会让用户困惑 */
async function isDuplicate(DB: any, kind: ShortcutKind, target: string): Promise<boolean> {
  const row = await DB("shortcut").where("kind", kind).where("target", target).first();
  return !!row;
}

export function registerShortcutHandlers(DB: any) {
  /**
   * 列表 — 按 sort_order 升序
   *
   * 刻意**不**在这里附带图标：解析 favicon 要联网（超时 3.5s）、
   * 解析 exe 图标要起一个 powershell 进程，塞进列表接口会让整个面板
   * 陪着等图标。渲染层拿到列表先渲染占位，再单独调 shortcut:icons 补图。
   */
  ipcMain.handle("shortcut:list", async (): Promise<ShortcutRow[]> => {
    try {
      const rows = await DB("shortcut").select("*").orderBy("sort_order", "asc").orderBy("id", "asc");
      return rows as ShortcutRow[];
    } catch (err) {
      log.error("shortcut:list error:", err);
      return [];
    }
  });

  /**
   * 解析**单个**快捷方式的图标
   *
   * 刻意不提供批量接口。三类图标的耗时差了两个数量级：网页 favicon 是几百毫秒的
   * 一次网络请求，本地程序则是要拉起 powershell.exe、跑一遍 Icon.ExtractAssociatedIcon
   * 的 2~4 秒。若合成一个 Promise.all 再回给渲染层，一个慢的程序图标会把所有
   * favicon 一起拖到 3 秒之后才出现 —— 表现就是整面板先灰着、然后一起亮。
   * 逐个请求、谁先回来谁先显示，慢的那一个只影响自己。
   */
  ipcMain.handle(
    "shortcut:resolve-icon",
    async (_event, kind: string, target: string): Promise<string | null> => {
      try {
        const safeKind = coerceKind(kind);
        if (!safeKind || typeof target !== "string" || !target.trim()) return null;
        return await resolveShortcutIcon(safeKind, target);
      } catch (err) {
        log.error("shortcut:resolve-icon error:", err);
        return null;
      }
    }
  );

  /** 新增 — 已存在同名目标时拒绝，不做静默覆盖 */
  ipcMain.handle(
    "shortcut:add",
    async (_event, input: ShortcutInput): Promise<{ success: boolean; error?: string; id?: number }> => {
      try {
        const normalized = normalizeInput(input);
        if ("error" in normalized) return { success: false, error: normalized.error };

        if (await isDuplicate(DB, normalized.kind, normalized.target)) {
          return { success: false, error: "这个快捷方式已经添加过了" };
        }

        // 追加到末尾：取当前位次最大的一行再 +1。
        //
        // 这里刻意用「按列排序取首行」而不是 DB.max("sort_order")：knex 在
        // sqlite3 上把聚合结果的别名回成 `max(`sort_order`)`（带反引号），
        // 读 .max 拿到的是 undefined，`Number(undefined ?? -1) + 1` 恒等于 0 ——
        // 于是每一条新增都插到 sort_order=0，表现为新加的快捷方式总排在最前面。
        // 直接读真实列名就没有这层方言差异。
        //
        // 也不用 count()：删过行之后 count 比真实最大位次小，会把新行插到中间。
        const last = await DB("shortcut").orderBy("sort_order", "desc").orderBy("id", "desc").first();
        const nextOrder = Number(last?.sort_order ?? -1) + 1;

        const id = await DB("shortcut").insert({
          kind: normalized.kind,
          target: normalized.target,
          title: normalized.title,
          sort_order: nextOrder,
        });

        return { success: true, id: id[0] };
      } catch (err) {
        log.error("shortcut:add error:", err);
        // 面向用户的那条用中文：原文是 knex/sqlite 的英文黑话，
        // 直接显示出来用户既看不懂也不知道该干什么
        return { success: false, error: describeDBError(err) };
      }
    }
  );

  /** 改名 / 改目标 */
  ipcMain.handle(
    "shortcut:update",
    async (
      _event,
      id: number,
      patch: { title?: string; target?: string }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const row = await DB("shortcut").where("id", id).first();
        if (!row) return { success: false, error: "快捷方式不存在" };

        const updates: Record<string, unknown> = { updated_at: new Date() };

        if (typeof patch?.title === "string") {
          const title = patch.title.trim();
          if (title) updates.title = title;
        }

        // 目标可改，但要走和新增同一套校验，否则能存进一条打不开的记录
        if (typeof patch?.target === "string" && patch.target.trim() !== row.target) {
          const normalized = normalizeInput({ kind: row.kind, target: patch.target });
          if ("error" in normalized) return { success: false, error: normalized.error };
          if (await isDuplicate(DB, normalized.kind, normalized.target)) {
            return { success: false, error: "这个快捷方式已经添加过了" };
          }
          updates.target = normalized.target;
          if (!patch.title?.trim()) updates.title = normalized.title;
        }

        await DB("shortcut").where("id", id).update(updates);
        return { success: true };
      } catch (err) {
        log.error("shortcut:update error:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle("shortcut:delete", async (_event, id: number): Promise<boolean> => {
    try {
      await DB("shortcut").where("id", id).delete();
      return true;
    } catch (err) {
      log.error("shortcut:delete error:", err);
      return false;
    }
  });

  /**
   * 拖拽后重排
   *
   * 整体重写 0..n-1 而不是两两交换：交换在中途失败时会留下重复的
   * sort_order，之后的列表顺序就变成不确定的，而且没有自愈路径。
   * 全量重写是幂等的 —— 同样的 ids 重放一次结果不变。
   */
  ipcMain.handle("shortcut:reorder", async (_event, ids: number[]): Promise<boolean> => {
    try {
      if (!Array.isArray(ids)) return false;
      for (let i = 0; i < ids.length; i++) {
        await DB("shortcut").where("id", ids[i]).update({ sort_order: i });
      }
      return true;
    } catch (err) {
      log.error("shortcut:reorder error:", err);
      return false;
    }
  });

  /** 打开 — 网址走系统浏览器，程序/文件夹交给 shell */
  ipcMain.handle(
    "shortcut:open",
    async (_event, id: number): Promise<{ success: boolean; error?: string }> => {
      try {
        const row = await DB("shortcut").where("id", id).first();
        if (!row) return { success: false, error: "快捷方式不存在" };

        if (row.kind === "url") {
          await shell.openExternal(row.target);
          return { success: true };
        }

        // 路径可能已经被删除/移动。openPath 返回的是错误字符串而不是抛异常，
        // 不看返回值的话界面会显示"打开了"，实际什么都没发生
        const failure = await shell.openPath(row.target);
        if (failure) return { success: false, error: failure };
        return { success: true };
      } catch (err) {
        log.error("shortcut:open error:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  /**
   * 系统选择器 — 供「添加本地程序 / 添加文件夹」使用
   *
   * 窗口句柄**在调用时**现取。这个 handler 注册在 createMainWindow 之前，
   * 如果把句柄当参数传进来，快照到的会是 null，点了按钮毫无反应也不报错。
   */
  ipcMain.handle(
    "shortcut:pick",
    async (_event, kind: string): Promise<ShortcutPickResult | null> => {
      try {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) {
          log.error("shortcut:pick 调用时主窗口不存在，无法打开选择框");
          return null;
        }

        if (kind === "folder") {
          const res = await dialog.showOpenDialog(win, {
            title: "选择文件夹",
            properties: ["openDirectory"],
          });
          const picked = res.filePaths[0];
          return picked ? { kind: "folder", target: picked, title: deriveTitle("folder", picked) } : null;
        }

        const res = await dialog.showOpenDialog(win, {
          title: "选择程序",
          properties: ["openFile"],
          filters: [
            { name: "程序", extensions: APP_EXTENSIONS.map((ext) => ext.slice(1)) },
            { name: "所有文件", extensions: ["*"] },
          ],
        });
        const picked = res.filePaths[0];
        return picked ? { kind: "app", target: picked, title: deriveTitle("app", picked) } : null;
      } catch (err) {
        log.error("shortcut:pick error:", err);
        return null;
      }
    }
  );

  /** 系统右键菜单项的注册状态 */
  ipcMain.handle("shell-menu:status", async () => {
    return await getContextMenuStatus();
  });

  /**
   * 修复失效的右键菜单命令
   *
   * 菜单项在、命令失效时（升级换目录、旧版本残留、值写空），
   * 右键能看见这一项、点了却毫无反应。应用启动时会自愈一次，
   * 这里给界面留一个手动入口 —— 用户当场就能修好，不用重启。
   */
  ipcMain.handle("shell-menu:repair", async () => {
    try {
      return await repairContextMenu();
    } catch (err) {
      log.error("shell-menu:repair error:", err);
      return { success: false, repaired: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 开关系统右键菜单项 */
  ipcMain.handle(
    "shell-menu:set",
    async (_event, enabled: boolean): Promise<{ success: boolean; error?: string }> => {
      return await setContextMenuEnabled(!!enabled);
    }
  );

  /** 清空快捷方式 */
  ipcMain.handle("shortcut:clear", async (): Promise<boolean> => {
    try {
      await DB("shortcut").del();
      return true;
    } catch (err) {
      log.error("shortcut:clear error:", err);
      return false;
    }
  });

  /** 把外部唤起的目标转成一条快捷方式输入，供渲染层弹出确认框 */
  ipcMain.handle("shortcut:normalize-target", async (_event, target: string) => {
    const trimmed = (target ?? "").trim();
    if (!trimmed) return null;
    const kind = inferShortcutKind(trimmed);
    const normalized = normalizeInput({ kind, target: trimmed });
    if ("error" in normalized) return { kind, target: trimmed, error: normalized.error };
    return normalized;
  });

  log.info(`快捷方式 IPC 处理器已注册（${app.isPackaged ? "打包版" : "开发版"}）`);
}
