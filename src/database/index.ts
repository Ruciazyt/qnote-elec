import knex, { Knex } from "knex";
import * as path from "path";
import * as fs from "fs";
import { log } from "../main/utils/log";

let DB: Knex | null = null;

// 关闭数据库连接
export function closeDB(): void {
  if (DB) {
    try {
      DB.destroy();
      DB = null;
      log.info("数据库连接已关闭");
    } catch (error) {
      log.error("关闭数据库连接失败:", error);
    }
  }
}

export function getDB(appPath?: string): Knex {
  let dbPath: string;
  log.info("appPath:", appPath);
  log.info("start to get DB");
  if (appPath) {
    // 生产环境 - 使用userDataPath/db目录
    const dbDir = path.join(appPath, "db");
    if (!fs.existsSync(dbDir)) {
      log.info("创建目录:", dbDir);
      fs.mkdirSync(dbDir, { recursive: true });
    }
    dbPath = path.join(dbDir, "clipboard.sqlite");
    log.info("生产环境使用数据库路径:", dbPath);
  } else {
    // 开发环境：数据库放在**项目根的 .data/**，不能放在 dist/ 里。
    //
    // __dirname 在运行时是 <项目根>/dist/database，而 dist 是构建产物目录。
    // 早先这里直接 path.join(__dirname, "clipboard.sqlite")，于是：
    // 只要有任何操作清理 dist（pnpm build 里的 clean = rimraf dist、
    // 一次手滑的 rimraf、一个 pre 脚本），用户的剪贴板历史、笔记索引、
    // Todo、AI 对话就会一起消失，而且不留痕迹 —— rimraf 不走回收站。
    // 开发期数据库是长期数据，绝不能和会被重建的产物目录同处一地。
    //
    // 生产环境用 userDataPath/db（见上），两边都不再依赖构建目录。
    //
    // 这里不写死层数（path.resolve(__dirname, "..", "..")），而是向上找
    // package.json 来定位项目根：万一以后 outDir 层级调整，写死层数会静默
    // 把数据库写到项目外面去，而那个目录既不会被 .gitignore 覆盖，也不在
    // 用户预期的地方，丢了更难找。
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

  // 如果已有连接且路径相同，直接返回现有连接
  if (DB && DB.client.config.connection.filename === dbPath) {
    return DB;
  }

  // 关闭现有连接（如果有）
  if (DB) {
    DB.destroy();
  }

  DB = knex({
    client: "sqlite3",
    connection: {
      filename: dbPath,
    },
    useNullAsDefault: true,
  });

  return DB;
}