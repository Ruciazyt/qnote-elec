/**
 * 外部文件夹注册表 —— 笔记页侧栏「外部文件夹」区域的真值源
 *
 * 笔记根目录只有一个（见 FileWriter），外部文件夹可以有多个：
 * 用户从磁盘任意路径把文件夹添加进来，侧栏下半部分按树展示其中的笔记文件。
 *
 * 持久化落在 settings 表里（一行 JSON），不另建表 —— 这份清单只有一个键，
 * 单独建表反而多一套迁移。
 *
 * ## 安全边界
 *
 * 渲染层不能直接指定「要操作哪个目录」：它只能拿 id 来要，
 * 由主进程把 id 解析成已登记的路径。渲染层属于可能被攻陷的一端，
 * 给了它传任意路径的能力，就等于让它把文件操作指到磁盘上任何位置。
 */
import * as fs from "fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { ExternalFolder } from "../../shared/noteTypes";
import { log } from "../utils/log";

/** settings 表里存这份清单的键名 */
const CONFIG_KEY = "external_note_folders";

/** 清单里的每一项 */
interface StoredFolder {
  id: string;
  path: string;
  name: string;
}

/** 判断一条记录是不是一份完整的外部文件夹 */
function isStoredFolder(v: unknown): v is StoredFolder {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.path === "string" && typeof o.name === "string";
}

/**
 * Windows 上路径不区分大小写，比较前先归一化，
 * 否则同一个目录能被以不同大小写重复添加。
 */
function pathKey(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/** 取目录显示名；根目录（"C:\"）这类退化情况退回整条路径 */
function folderNameOf(dirPath: string): string {
  const normalized = path.resolve(dirPath);
  const base = path.basename(normalized);
  return base && base !== normalized ? base : normalized;
}

export class ExternalFolderStore {
  constructor(private readonly DB: Knex) {}

  /** 读清单；记录缺失或损坏时按「没有外部文件夹」处理 */
  async list(): Promise<ExternalFolder[]> {
    try {
      const row = await this.DB("settings").where("configName", CONFIG_KEY).first();
      if (!row?.configValue) return [];
      const parsed = JSON.parse(row.configValue);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isStoredFolder).map((f) => ({
        id: f.id,
        path: f.path,
        name: f.name,
      }));
    } catch (err) {
      log.error("读取外部文件夹清单失败", err);
      return [];
    }
  }

  /** 按 id 取一条；取不到返回 null */
  async get(id: string): Promise<ExternalFolder | null> {
    if (!id) return null;
    const all = await this.list();
    return all.find((f) => f.id === id) ?? null;
  }

  /**
   * 追加文件夹
   *
   * 已经登记过的路径直接跳过；不存在的路径与非目录也会跳过（不报错 ——
   * 用户可能一次选多个，其中一个刚好被删了，不该让整次添加失败）。
   */
  async add(dirs: string[]): Promise<ExternalFolder[]> {
    const current = await this.list();
    const known = new Set(current.map((f) => pathKey(f.path)));
    const added: ExternalFolder[] = [];

    for (const raw of dirs || []) {
      if (!raw) continue;
      const resolved = path.resolve(raw);
      const key = pathKey(resolved);
      if (known.has(key)) continue;
      try {
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          log.warn(`跳过不是目录的路径: ${resolved}`);
          continue;
        }
      } catch (err) {
        log.warn(`跳过无法访问的路径: ${resolved}`, err);
        continue;
      }
      known.add(key);
      added.push({
        id: randomUUID(),
        path: resolved,
        name: folderNameOf(resolved),
      });
    }

    if (added.length === 0) return current;

    const next = [...current, ...added];
    await this.save(next);
    log.info(`已添加 ${added.length} 个外部文件夹: ${added.map((f) => f.path).join(", ")}`);
    return next;
  }

  /**
   * 从清单里移除
   *
   * 只改清单，不动磁盘上的文件 —— 这是「移出侧栏」而不是「删除文件夹」。
   */
  async remove(id: string): Promise<ExternalFolder[]> {
    const current = await this.list();
    const next = current.filter((f) => f.id !== id);
    if (next.length === current.length) return current;
    await this.save(next);
    return next;
  }

  /** 落盘：settings 表里那一行 JSON */
  private async save(list: ExternalFolder[]): Promise<void> {
    const payload = JSON.stringify(list);
    try {
      const existing = await this.DB("settings").where("configName", CONFIG_KEY).first();
      if (existing) {
        await this.DB("settings")
          .where("configName", CONFIG_KEY)
          .update({ configValue: payload, updated_at: new Date() });
      } else {
        await this.DB("settings").insert({
          configName: CONFIG_KEY,
          configValue: payload,
        });
      }
    } catch (err) {
      log.error("保存外部文件夹清单失败", err);
      throw err;
    }
  }
}
