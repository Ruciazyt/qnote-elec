import * as fs from "node:fs";
import * as path from "node:path";
import { IpcMainInvokeEvent } from "electron";
import { log } from "../system/log";
import { Knex } from "knex";

export class FileWriter {
  private filePath: string;
  private readonly defaultDir: string;
  private DB: Knex;

  constructor(DB: Knex, defaultDir: string) {
    this.DB = DB;
    this.defaultDir = defaultDir;
    this.filePath = defaultDir;
  }

  async initPath() {
    try {
      const res = await this.DB("settings")
        .where("configName", "file_path")
        .select("configValue");

      if (res.length > 0) {
        const stored = res[0].configValue;
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
