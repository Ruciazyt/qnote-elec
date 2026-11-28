import * as fs from "node:fs";
import * as path from "node:path";
import type { Knex } from "knex";
import { log } from "../../system/log";
import {
  LEGACY_MANIFEST_FILENAME,
  PLUGIN_MANIFEST_FILENAME,
} from "../manifest/pluginManifest";
import { parseLegacyPreview } from "../../../../shared/plugin/manifest/pluginPreview";
import { buildPluginCommandLine } from "../../../../shared/plugin/manifest/pluginManifest";
import type { PluginManifest, PluginRuntimeConfig } from "../../../../shared/plugin/manifest/pluginTypes";
import { readPluginRecord } from "../runtime/pluginManager";

export interface LegacyMigrationResult {
  migrated: number;
  skipped: number;
  failed: string[];
}

const SLUG_SEPARATOR = ".-";
const MAX_SEGMENT_LENGTH = 120;

export function slugifyPluginSegment(text: string): string {
  const replaced = text.replace(/[^\p{L}\p{N}.-]+/gu, "-");
  let start = 0;
  let end = replaced.length;
  while (start < end && SLUG_SEPARATOR.includes(replaced[start])) start += 1;
  while (end > start && SLUG_SEPARATOR.includes(replaced[end - 1])) end -= 1;
  const collapsed = replaced
    .slice(start, end)
    .toLowerCase()
    .split(".")
    .filter(Boolean)
    .join(".");
  let trimmed = collapsed.slice(0, MAX_SEGMENT_LENGTH);
  while (trimmed.length > 0 && SLUG_SEPARATOR.includes(trimmed[trimmed.length - 1])) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed || "plugin";
}

function defaultEngines(hostVersion: string): string {
  const parts = hostVersion.split(".");
  const major = parts[0] || "0";
  const minor = parts[1] || "0";
  return `^${major}.${minor}.0`;
}

function buildLegacyManifest(
  legacy: Record<string, unknown>,
  id: string,
  fallbackName: string,
  hostVersion: string
): PluginManifest {
  const runtime: PluginRuntimeConfig = {};
  if (typeof legacy.command === "string" && legacy.command.trim()) {
    runtime.command = legacy.command.trim();
  }
  if (Array.isArray(legacy.args)) {
    const args = legacy.args
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim())
      .filter(Boolean);
    if (args.length > 0) runtime.args = args;
  }
  if (typeof legacy.cwd === "string" && legacy.cwd.trim()) {
    runtime.cwd = legacy.cwd.trim();
  }
  if (legacy.env && typeof legacy.env === "object" && !Array.isArray(legacy.env)) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(legacy.env as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        const name = key.trim();
        if (name) env[name] = String(value);
      }
    }
    if (Object.keys(env).length > 0) runtime.env = env;
  }
  const preview = parseLegacyPreview(legacy.preview);
  if (preview) runtime.preview = preview;

  const manifest: PluginManifest = {
    id,
    name:
      typeof legacy.name === "string" && legacy.name.trim()
        ? legacy.name.trim()
        : fallbackName,
    version: "0.0.1",
    publisher: "local",
    engines: { qnote: defaultEngines(hostVersion) },
    runtime,
    capabilities: { process: { spawn: true } },
  };

  if (typeof legacy.description === "string" && legacy.description.trim()) {
    manifest.description = legacy.description.trim();
  }

  return manifest;
}

async function tableExists(DB: Knex, name: string): Promise<boolean> {
  try {
    return await DB.schema.hasTable(name);
  } catch {
    return false;
  }
}

/**
 * 把 1.x 的 app_project 记录迁成 plugin 记录，并在插件目录里补一份 plugin.json。
 * 幂等：已迁过的路径会跳过；原 qnote.json 与 app_project 表都保留不动。
 */
export async function migrateLegacyProjects(
  DB: Knex,
  hostVersion: string
): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = { migrated: 0, skipped: 0, failed: [] };

  if (!(await tableExists(DB, "app_project"))) {
    return result;
  }
  if (!(await tableExists(DB, "plugin"))) {
    return result;
  }

  let rows: any[] = [];
  try {
    rows = await DB("app_project").select("*");
  } catch (err) {
    log.error("[plugin] 读取旧应用表失败:", err);
    return result;
  }

  for (const row of rows) {
    const dir = String(row.path ?? "");
    if (!dir) {
      result.skipped += 1;
      continue;
    }

    try {
      const existing = await DB("plugin").where("path", dir).first();
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const legacyPath = path.join(dir, LEGACY_MANIFEST_FILENAME);
      if (!fs.existsSync(legacyPath)) {
        result.skipped += 1;
        continue;
      }

      const text = fs.readFileSync(legacyPath, "utf-8"); // NOSONAR
      let legacy: Record<string, unknown>;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          result.skipped += 1;
          continue;
        }
        legacy = parsed as Record<string, unknown>;
      } catch {
        result.skipped += 1;
        continue;
      }

      const slug = slugifyPluginSegment(path.basename(dir) || dir);
      let id = `local.${slug}`;
      let suffix = 2;
      while (await DB("plugin").where("id", id).first()) {
        id = `local.${slug}-${suffix}`;
        suffix += 1;
      }

      const manifest = buildLegacyManifest(
        legacy,
        id,
        path.basename(dir) || dir,
        hostVersion
      );

      const manifestPath = path.join(dir, PLUGIN_MANIFEST_FILENAME);
      if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          "utf-8"
        ); // NOSONAR
      }

      const record = readPluginRecord(dir, hostVersion);
      await DB("plugin").insert({
        ...record,
        path: dir,
        origin: row.origin ?? "local",
        enabled: 1,
        confirmed_manifest_hash: "",
        sort_order: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });

      result.migrated += 1;
      log.info(`[plugin] 已迁移旧应用为插件：${manifest.name}（${id}）`);
    } catch (err) {
      result.failed.push(`${dir}：${err instanceof Error ? err.message : String(err)}`);
      log.error(`[plugin] 迁移旧应用失败 ${dir}:`, err);
    }
  }

  if (result.migrated > 0 || result.failed.length > 0) {
    log.info(
      `[plugin] 旧应用迁移完成：迁移 ${result.migrated} 个，跳过 ${result.skipped} 个，失败 ${result.failed.length} 个`
    );
  }

  return result;
}

export function describeLegacyCommand(runtime: PluginRuntimeConfig): string {
  return buildPluginCommandLine(runtime);
}
