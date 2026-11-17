import * as fs from "fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { ExternalFolder } from "../../../shared/notes/noteTypes";
import { log } from "../system/log";

const CONFIG_KEY = "external_note_folders";

interface StoredFolder {
  id: string;
  path: string;
  name: string;
}

function isStoredFolder(v: unknown): v is StoredFolder {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.path === "string" && typeof o.name === "string";
}

function pathKey(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

function folderNameOf(dirPath: string): string {
  const normalized = path.resolve(dirPath);
  const base = path.basename(normalized);
  return base && base !== normalized ? base : normalized;
}

export class ExternalFolderStore {
  constructor(private readonly DB: Knex) {}

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

  async get(id: string): Promise<ExternalFolder | null> {
    if (!id) return null;
    const all = await this.list();
    return all.find((f) => f.id === id) ?? null;
  }

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

  async remove(id: string): Promise<ExternalFolder[]> {
    const current = await this.list();
    const next = current.filter((f) => f.id !== id);
    if (next.length === current.length) return current;
    await this.save(next);
    return next;
  }

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
