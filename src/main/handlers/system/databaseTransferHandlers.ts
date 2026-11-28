import { BrowserWindow, dialog, ipcMain } from "electron";
import knex from "knex";
import type { Knex } from "knex";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../../core/system/log";
import { closeDB } from "../../../database/index";

type ExportResult =
  | { success: true; filePath: string }
  | { success: false; error?: string; canceled?: boolean };

type ImportResult =
  | {
      success: true;
      sourcePath: string;
      backupPath: string;
      requiresRestart: boolean;
    }
  | { success: false; error?: string; canceled?: boolean };

function getDbFilePath(DB: Knex | null): string | null {
  const configuredPath = DB?.client?.config?.connection?.filename;
  if (typeof configuredPath === "string" && configuredPath.length > 0) {
    return configuredPath;
  }
  return null;
}

async function ensureDirectory(filePath: string) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

async function copyFileSafe(src: string, dest: string) {
  await ensureDirectory(dest);
  await fs.promises.copyFile(src, dest);
}

function timestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const REQUIRED_TABLES = ["settings", "note"];

async function verifyDatabaseFile(filePath: string): Promise<string | null> {
  const probe = knex({
    client: "sqlite3",
    connection: { filename: filePath },
    useNullAsDefault: true,
  });
  try {
    const rows = await probe("sqlite_master").select("name");
    const names = new Set(rows.map((row) => String(row.name)));
    const missing = REQUIRED_TABLES.filter((table) => !names.has(table));
    if (missing.length > 0) {
      return `导入文件不是 QNote 的数据库（缺少 ${missing.join("、")} 表）`;
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `导入文件不是可用的 SQLite 数据库：${message}`;
  } finally {
    await probe.destroy().catch(() => undefined);
  }
}

async function removeSidecars(dbPath: string): Promise<void> {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = dbPath + suffix;
    try {
      if (fs.existsSync(sidecar)) {
        await fs.promises.rm(sidecar, { force: true });
      }
    } catch (err) {
      log.warn("删除数据库附属文件失败: " + sidecar, err);
    }
  }
}

export function registerDatabaseTransferHandlers(DB: Knex | null, win: BrowserWindow | null) {
  ipcMain.handle("export-database", async (): Promise<ExportResult> => {
    const dbPath = getDbFilePath(DB);
    if (!dbPath) {
      return { success: false, error: "数据库尚未初始化" };
    }

    try {
      await DB?.raw("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (err) {
      log.warn("执行 wal_checkpoint 失败", err);
    }

    const defaultPath = path.join(
      path.dirname(dbPath),
      `clipboard-backup-${timestampSuffix()}.sqlite`
    );

    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
      title: "导出数据库",
      defaultPath,
      filters: [{ name: "SQLite 数据库", extensions: ["sqlite"] }],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    try {
      await copyFileSafe(dbPath, filePath);
      log.info("数据库已导出", { filePath });
      return { success: true, filePath };
    } catch (error) {
      log.error("导出数据库失败", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("import-database", async (): Promise<ImportResult> => {
    const dbPath = getDbFilePath(DB);
    if (!dbPath) {
      return { success: false, error: "数据库尚未初始化" };
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? null, {
      title: "导入数据库",
      filters: [{ name: "SQLite 数据库", extensions: ["sqlite"] }],
      properties: ["openFile"],
    });

    if (canceled || !filePaths || !filePaths[0]) {
      return { success: false, canceled: true };
    }

    const sourcePath = filePaths[0];

    try {
      await fs.promises.access(sourcePath, fs.constants.R_OK);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("导入数据库时无法读取源文件", { sourcePath, error });
      return { success: false, error: `无法读取导入文件: ${message}` };
    }

    const problem = await verifyDatabaseFile(sourcePath);
    if (problem) {
      return { success: false, error: problem };
    }

    const backupPath = path.join(
      path.dirname(dbPath),
      `clipboard-backup-before-import-${timestampSuffix()}.sqlite`
    );

    try {
      await copyFileSafe(dbPath, backupPath);
    } catch (error) {
      log.error("备份当前数据库失败", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      await DB?.raw("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (err) {
      log.warn("导入前 checkpoint 失败", err);
    }

    closeDB();

    try {
      await copyFileSafe(sourcePath, dbPath);
    } catch (error) {
      log.error("导入数据库失败", error);
      try {
        await copyFileSafe(backupPath, dbPath);
      } catch (restoreErr) {
        log.error("回滚原数据库失败", restoreErr);
      }
      return {
        success: false,
        error: "导入失败，已回滚到原数据库；请重启应用后再试",
      };
    }

    await removeSidecars(dbPath);
    log.info("数据库导入完成", { sourcePath, backupPath });
    return {
      success: true,
      sourcePath,
      backupPath,
      requiresRestart: true,
    };
  });
}

