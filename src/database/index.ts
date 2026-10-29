import knex, { Knex } from "knex";
import * as path from "path";
import * as fs from "fs";
import { log } from "../main/utils/log";

let DB: Knex | null = null;

// 关闭数据库连接
export function closeDB(): void {
  if (DB) {
    try {
      // destroy() 是异步的：外层 try/catch 只能兜住同步抛错，接不住异步 reject。
      // 所以这里显式挂 .catch 记日志 —— 否则关闭失败会变成"未处理的Promise拒绝"，
      // 只在全局兜底里留下一句无上下文的记录。
      // DB = null 的时机保持不变：仍在同步流程里立即置空，不等 destroy 完成。
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
    // getDB 是同步函数，不能改成 await（会改签名并波及所有调用方）。
    // 这里显式忽略返回值并挂 .catch：关闭失败要有日志，不能变成"未处理的Promise拒绝"。
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

/**
 * 把数据库错误翻译成用户看得懂的中文
 *
 * 这些报错原文全是英文的技术黑话（"Unable to acquire a connection"），
 * 直接甩到界面上用户既看不懂也不知道该干什么 —— 截图里那条红底白字的
 * "Unable to acquire a connection" 就是这么来的。
 *
 * 这里的映射只覆盖"用户能自己处理"的几类：重试有用、或者换个动作有用。
 * 认不出来的错误保持原文，不要硬编 —— 原文进日志，用户反馈时能对照。
 */
export function describeDBError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
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

/**
 * 给 knex 实例装上"连接池自愈"
 *
 * ## 背景
 *
 * knex 在 `destroy()` 之后会把 `client.pool` 置为 undefined，此后**任何**查询
 * 都在 `client.acquireConnection()` 里抛 `Unable to acquire a connection`
 * （knex/lib/client.js 里就是这个报错原文）。
 *
 * 这本来是"连接已销毁"的正确语义，但本项目里有一个致命组合：
 * 各 handler 在注册时把 knex 实例**捕获**下来长期使用，而退出流程又会在
 * `before-quit` 里销毁连接池 —— 一旦退出被窗口的 close 处理器取消，
 * 应用就带着一个"池已销毁"的实例继续跑，所有写库功能（清空记录、
 * 添加快捷方式、置顶、标记重要……）集体失效。
 *
 * ## 做法
 *
 * 在真正取连接之前检查一次池是否还在，不在就**原位重建**。
 * `client.initializePool()` 会在 pool 缺失时用同一份配置新建一个连接池，
 * 而 knex 实例本身不变 —— 这一点很关键：各 handler 手里拿的是同一个实例引用，
 * 原位重建之后它们不需要重新注册就能继续用。
 *
 * 已实测：destroy → initializePool → 查询恢复正常。
 */
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
        // 重建失败就让它按原样抛错，不要吞掉真实原因
        throw err;
      }
    }
    return await originalAcquireConnection();
  };
}