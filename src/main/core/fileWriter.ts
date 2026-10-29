import * as fs from "fs";
import * as path from "path";
import { IpcMainInvokeEvent } from "electron";
import { log } from "../utils/log";
import { Knex } from "knex";

/**
 * 笔记目录访问器 —— 笔记根路径的真值源
 *
 * 为什么不让调用方各自查 settings 表：这个类持有路径，并集中处理
 * 「未设置」时的回退。别处自己查 DB 会绕开那套回退，遇到空值就会
 * 拿到一个不可用的路径。
 *
 * 笔记页（fileHandlers）和 AI 工具（save_note / list_notes / read_note）
 * 都经由它取路径 —— 这是保证「AI 存的笔记出现在用户看到的位置」的唯一依据。
 * 新增调用方请照此办理，不要自己读 settings 表。
 */
export class FileWriter {
  /** 笔记根目录 */
  private filePath: string;
  /** 默认目录（从外部传入，一般是 <userData>/notes） */
  private readonly defaultDir: string;
  private DB: Knex;

  constructor(DB: Knex, defaultDir: string) {
    this.DB = DB;
    this.defaultDir = defaultDir;
    // 初始值用 defaultDir；initPath() 会读 DB 覆盖
    this.filePath = defaultDir;
    // initPath 将在外部显式调用
  }

  async initPath() {
    try {
      const res = await this.DB("settings")
        .where("configName", "file_path")
        .select("configValue");

      if (res.length > 0) {
        const stored = res[0].configValue;
        // 未设置：回退到默认目录
        if (!stored) {
          log.info(`笔记目录未设置，回退到默认目录 ${this.defaultDir}`);
          await this.DB("settings")
            .where("configName", "file_path")
            .update({ configValue: this.defaultDir });
          this.filePath = this.defaultDir;
        } else {
          this.filePath = stored;
        }
      } else {
        // 没有记录，插入默认目录
        await this.DB("settings").insert({
          configName: "file_path",
          configValue: this.defaultDir,
        });
        this.filePath = this.defaultDir;
        log.info("默认笔记目录已写入:", this.defaultDir);
      }
    } catch (err) {
      log.error("Error getting or setting file path:", err);
    }
    log.info("笔记目录初始化完成:", this.filePath);
  }

  openFileForWriteSync(filePath: string): number {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const fd = fs.openSync(filePath, "a");
      return fd;
    } catch (err) {
      log.error(`Error opening or creating file at ${filePath}:`, err);
      throw err;
    }
  }

  writeToFileSync(_event: IpcMainInvokeEvent, data: string): Promise<string> {
    try {
      const fd = this.openFileForWriteSync(this.filePath);
      fs.writeSync(fd, Buffer.from(`\n${data}`, "utf8"));
      fs.closeSync(fd);
      return Promise.resolve("success");
    } catch (err) {
      log.error("Error writing to file descriptor", err);
      throw err;
    }
  }

  async setFilePath(filePath: string): Promise<void> {
    if (!filePath) {
      return;
    }
    try {
      await this.DB("settings")
        .where("configName", "file_path")
        .update({ configValue: filePath });
      this.filePath = filePath;
    } catch (err) {
      log.error("Error updating file path:", err);
    }
  }

  /**
   * 同步取当前笔记根目录（内存副本）
   *
   * getFilePath() 每次都查 DB，适合渲染层主动问「根目录是哪个」；
   * 主进程内部在 IPC 通道里要拿它做校验时，异步查询会把整个通道改成 async，
   * 而这份内存副本本来就和 DB 同步（initPath / setFilePath 都会更新它）。
   *
   * 笔记根目录只能由用户经系统目录选择框确定，主进程自己存着 ——
   * 渲染层属于可能被攻陷的一端，不能让它决定文件操作落在哪个目录。
   */
  getRootPath(): string {
    return this.filePath;
  }

  async getFilePath(): Promise<string> {
    try {
      const res = await this.DB("settings")
        .where("configName", "file_path")
        .select("configValue");
      if (res.length > 0) {
        const stored = res[0].configValue;
        // 防御性回退：值为空时用默认目录
        if (!stored) {
          await this.DB("settings")
            .where("configName", "file_path")
            .update({ configValue: this.defaultDir });
          this.filePath = this.defaultDir;
        } else {
          this.filePath = stored;
        }
      }
      return this.filePath;
    } catch (err) {
      log.error("Error getting file path:", err);
      throw err;
    }
  }
}
