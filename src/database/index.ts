import knex, { Knex } from "knex";
import * as path from "node:path";
import * as fs from "node:fs";
import { log } from "../main/core/system/log";

let DB: Knex | null = null;

export function closeDB(): void {
  if (DB) {
    try {
      DB.destroy().catch((error) => {
        log.error("关闭数据库连接失败:", error);
      });
      DB = null;
      log.info("数据库连接已关闭");
    } catch (error) {
      log.error("关闭数据库连接失败:", error);
    }
  }
}

export function getDB(appPath?: string): Knex {
  // 无参数表示取当前连接。启动时安装版已用 userData 初始化，后续面板
  // 不能重新推导开发路径，否则会读错库并销毁主窗口正在使用的连接。
  if (!appPath && DB) return DB;

  let dbPath: string;
  log.info("appPath:", appPath);
  log.info("start to get DB");
  if (appPath) {
    const dbDir = path.join(appPath, "db");
    if (!fs.existsSync(dbDir)) {
      log.info("创建目录:", dbDir);
      fs.mkdirSync(dbDir, { recursive: true });
    }
    dbPath = path.join(dbDir, "clipboard.sqlite");
    log.info("生产环境使用数据库路径:", dbPath);
  } else {
    let projectRoot = __dirname;
    while (
      projectRoot !== path.dirname(projectRoot) &&
      !fs.existsSync(path.join(projectRoot, "package.json"))
    ) {
      projectRoot = path.dirname(projectRoot);
    }
    const dbDir = path.join(projectRoot, ".data");
    if (!fs.existsSync(dbDir)) {
      log.info("创建开发数据库目录:", dbDir);
      fs.mkdirSync(dbDir, { recursive: true });
    }
    dbPath = path.join(dbDir, "clipboard.sqlite");
    log.info("开发环境使用数据库路径:", dbPath);
  }

  if (DB && DB.client.config.connection.filename === dbPath) {
    return DB;
  }

  if (DB) {
    void DB.destroy().catch((error) => {
      log.error("关闭旧数据库连接失败:", error);
    });
  }

  DB = knex({
    client: "sqlite3",
    connection: {
      filename: dbPath,
    },
    useNullAsDefault: true,
  });

  installPoolSelfHeal(DB);

  return DB;
}

export function describeDBError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (JSON.stringify(err) ?? String(err ?? ""));
  const text = raw.toLowerCase();

  if (text.includes("unable to acquire a connection")) {
    return "数据库连接已失效，请重启应用后重试";
  }
  if (text.includes("database is locked") || text.includes("sqlite_busy")) {
    return "数据库正被占用，请稍后重试";
  }
  if (text.includes("unable to open database file") || text.includes("sqlite_cantopen")) {
    return "无法打开数据库文件，请检查目录权限与磁盘空间";
  }
  if (text.includes("attempt to write a readonly database")) {
    return "数据库处于只读状态，请检查目录权限";
  }
  if (text.includes("no such table")) {
    return "数据表缺失，请重启应用以完成数据库初始化";
  }
  return raw || "未知错误";
}

function installPoolSelfHeal(db: Knex): void {
  const client = db.client as any;
  if (!client || typeof client.acquireConnection !== "function") return;
  if (client.__qnoteSelfHealInstalled) return;
  client.__qnoteSelfHealInstalled = true;

  const originalAcquireConnection = client.acquireConnection.bind(client);

  client.acquireConnection = async () => {
    if (!client.pool) {
      log.warn("[db] 连接池已失效，已自动重建");
      try {
        client.initializePool();
      } catch (err) {
        log.error("[db] 重建连接池失败:", err);
        throw err;
      }
    }
    return await originalAcquireConnection();
  };
}
