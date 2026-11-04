import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Knex } from "knex";
import { log } from "../utils/log";
import { describeDBError } from "../../database";
import {
  APP_MANIFEST_FILENAME,
  buildCommandLine,
  parseManifestText,
  readManifestFromDir,
} from "../utils/appManifest";
import type {
  AppImportResult,
  AppLogLine,
  AppLogStream,
  AppManifest,
  AppProject,
  AppProjectStatus,
  AppRuntimeState,
} from "../../shared/appTypes";

/**
 * 应用管理核心
 *
 * 负责三件事：
 * 1. 项目的持久化（导入 → 落库 → 供界面读取）
 * 2. 常驻进程的启动 / 停止，以及输出日志的收集
 * 3. 向渲染层广播状态变化（项目列表、运行状态、日志行）
 *
 * 主进程是唯一数据源：渲染层不直接碰数据库，也不直接 spawn 进程。
 *
 * ## 为什么是「导入文件夹」而不是「选根目录再扫描」
 *
 * 项目往往散落在不同地方 —— 工作目录下的、个人目录里的、外接硬盘上的。
 * 让用户先选一个根、再从根里挑子文件夹，等于强迫所有项目挤进同一棵树里。
 * 现在导入的就是项目本身：一个文件夹 + 一份 qnote.json。
 */

/** 每个项目保留的日志行数上限 —— 防止长跑项目把内存吃满 */
const LOG_BUFFER_LIMIT = 400;

/** 进程事件出口 —— 由 handler 层注入，避免 core 反向依赖 ipcMain */
export interface AppEventSink {
  onProjectsChanged(projects: AppProject[]): void;
  onRuntimeChanged(state: AppRuntimeState): void;
  onLog(line: AppLogLine): void;
}

interface RuntimeEntry {
  child: ChildProcess;
  state: AppRuntimeState;
}

/** 单条输出流的分行缓冲 —— 一次 read 可能只到半行 */
class LineSplitter {
  private buffer = "";

  constructor(
    private readonly projectId: number,
    private readonly stream: AppLogStream,
    private readonly emit: (line: AppLogLine) => void
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const text = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (text.length > 0) this.emitLine(text);
      index = this.buffer.indexOf("\n");
    }
  }

  /** 进程结束时把没换行的尾巴也吐出来 */
  flush(): void {
    const text = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    if (text.length > 0) this.emitLine(text);
  }

  private emitLine(text: string): void {
    this.emit({
      projectId: this.projectId,
      stream: this.stream,
      text,
      at: Date.now(),
    });
  }
}

/** 一个目录作为项目时的解析结果 */
interface ProjectRecord {
  name: string;
  status: AppProjectStatus;
  /** 清单原文 —— 键名跟数据库列名一致，可以直接展开进 insert/update */
  manifest_text: string | null;
  command: string | null;
  preview: string | null;
  description: string | null;
  error: string | null;
}

export class AppManager {
  private sink: AppEventSink | null = null;
  /** projectId → 运行中的进程 */
  private runtimes = new Map<number, RuntimeEntry>();
  /** projectId → 日志缓冲 */
  private logs = new Map<number, AppLogLine[]>();
  /**
   * projectId → 项目根目录
   *
   * 预览协议的处理函数是异步的，但这里需要同步拿到目录 ——
   * knex 没有同步查询接口，所以读取时顺手把路径缓存下来。
   */
  private projectDirs = new Map<number, string>();

  constructor(private readonly DB: Knex) {}

  setEventSink(sink: AppEventSink): void {
    this.sink = sink;
  }

  // ------------------------------------------------------------------
  // 项目
  // ------------------------------------------------------------------

  /**
   * 导入一个项目文件夹
   *
   * 合规条件：目录下有一份能解析通过的 qnote.json。
   * 不合规时**不落库**，但把原因分类带回界面，让它能给出对应的补救动作。
   */
  async importProject(dirPath: string): Promise<AppImportResult> {
    try {
      const dir = path.resolve(String(dirPath ?? "").trim());
      if (!dir) return { ok: false, error: "目录不能为空", reason: "not-a-directory" };

      if (!fs.existsSync(dir)) {
        return { ok: false, error: "目录不存在", reason: "not-a-directory" };
      }
      let isDir = false;
      try {
        isDir = fs.statSync(dir).isDirectory(); // NOSONAR
      } catch {
        return { ok: false, error: "无法读取该目录", reason: "not-a-directory" };
      }
      if (!isDir) {
        return { ok: false, error: "选中的不是文件夹", reason: "not-a-directory" };
      }

      // 已经导入过 —— 同一个文件夹登记两次没有意义
      const existing = await this.DB("app_project").where("path", dir).first();
      if (existing) {
        return {
          ok: false,
          error: "这个项目已经导入了",
          reason: "already-imported",
        };
      }

      const record = readProjectRecord(dir);
      if (record.status !== "ready") {
        return {
          ok: false,
          error: record.error ?? "该文件夹不符合规范",
          reason:
            record.status === "missing-manifest" ? "missing-manifest" : "invalid-manifest",
        };
      }

      const inserted = await this.DB("app_project").insert({
        ...record,
        path: dir,
        sort_order: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const id = inserted[0];
      this.projectDirs.set(id, dir);

      const project = await this.getProject(id);
      await this.broadcastProjects();
      return { ok: true, project: project ?? undefined };
    } catch (err) {
      log.error("[app] 导入项目失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  /** 移除项目 —— 连同它的进程一起停掉 */
  async removeProject(id: number): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.stopProject(id);
      await this.DB("app_project").where("id", id).delete();
      this.projectDirs.delete(id);
      this.logs.delete(id);
      await this.broadcastProjects();
      return { ok: true };
    } catch (err) {
      log.error("[app] 移除项目失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  /**
   * 重新读一遍所有已导入项目的清单
   *
   * 清单在项目文件夹里，用户随时可能改它 —— 改了之后刷新一下就能看到新配置，
   * 不需要重启应用。
   */
  async refreshProjects(): Promise<AppProject[]> {
    try {
      const rows = await this.DB("app_project").select("*");
      for (const row of rows) {
        const record = readProjectRecord(row.path as string);
        await this.DB("app_project")
          .where("id", row.id)
          .update({ ...record, updated_at: new Date() });
      }
      await this.broadcastProjects();
      return await this.listProjects();
    } catch (err) {
      log.error("[app] 刷新项目清单失败:", err);
      return [];
    }
  }

  async listProjects(): Promise<AppProject[]> {
    try {
      const rows = await this.DB("app_project")
        .select("*")
        .orderBy("sort_order", "asc")
        .orderBy("name", "asc");
      for (const row of rows) {
        this.projectDirs.set(row.id, row.path);
      }
      return rows.map((row) => this.toProject(row));
    } catch (err) {
      log.error("[app] 读取项目列表失败:", err);
      return [];
    }
  }

  private toProject(row: any): AppProject {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      status: row.status as AppProjectStatus,
      manifestText: row.manifest_text ?? undefined,
      command: row.command ?? undefined,
      preview: row.preview ?? undefined,
      description: row.description ?? undefined,
      error: row.error ?? undefined,
    };
  }

  async getProject(id: number): Promise<AppProject | null> {
    try {
      const row = await this.DB("app_project").where("id", id).first();
      if (!row) return null;
      this.projectDirs.set(row.id, row.path);
      return this.toProject(row);
    } catch (err) {
      log.error("[app] 读取项目失败:", err);
      return null;
    }
  }

  /**
   * 同步取项目根目录 —— 供预览协议使用
   *
   * 缓存没命中时返回 null，协议处理器会回 404。
   */
  getProjectDirSync(id: number): string | null {
    return this.projectDirs.get(id) ?? null;
  }

  /**
   * 写入项目清单（qnote.json）
   *
   * 创建和编辑走同一条路径：先把表单内容组装成清单，走一遍校验，
   * 校验过了才落盘。校验失败时**不写文件** —— 留一个半成品清单在项目里，
   * 下次读取又会被判成 invalid-manifest，用户反而看不懂哪里错了。
   */
  async writeManifest(
    projectPath: string,
    payload: Partial<AppManifest>
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const dir = path.resolve(projectPath);
      if (!fs.existsSync(dir)) return { ok: false, error: "项目目录不存在" };
      if (!fs.statSync(dir).isDirectory()) return { ok: false, error: "项目路径不是文件夹" };

      const manifest: AppManifest = {};
      const name = payload.name?.trim();
      if (name) manifest.name = name;
      const description = payload.description?.trim();
      if (description) manifest.description = description;
      const command = payload.command?.trim();
      if (command) manifest.command = command;
      const args = (payload.args ?? []).map((a) => a.trim()).filter(Boolean);
      if (args.length > 0) manifest.args = args;
      const cwd = payload.cwd?.trim();
      if (cwd) manifest.cwd = cwd;
      if (payload.env && Object.keys(payload.env).length > 0) manifest.env = payload.env;
      const preview = payload.preview?.trim();
      if (preview) manifest.preview = preview;

      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      const parsed = parseManifestText(text);
      if (!parsed.manifest) {
        return { ok: false, error: parsed.error ?? "清单内容不合法" };
      }

      fs.writeFileSync(path.join(dir, APP_MANIFEST_FILENAME), text, "utf-8");
      return { ok: true };
    } catch (err) {
      log.error("[app] 写入清单失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ------------------------------------------------------------------
  // 进程运行
  // ------------------------------------------------------------------

  getRuntimeStates(): AppRuntimeState[] {
    const states: AppRuntimeState[] = [];
    for (const [projectId, entry] of this.runtimes) {
      states.push({ ...entry.state, projectId });
    }
    return states;
  }

  getRuntimeState(projectId: number): AppRuntimeState | null {
    const entry = this.runtimes.get(projectId);
    return entry ? { ...entry.state, projectId } : null;
  }

  getLogs(projectId: number): AppLogLine[] {
    return [...(this.logs.get(projectId) ?? [])];
  }

  /** 清空某个项目的日志缓冲 */
  clearLogs(projectId: number): void {
    this.logs.set(projectId, []);
  }

  /**
   * 启动项目
   *
   * 以常驻进程运行：命令自己不退就一直跑，用户点「停止」才结束。
   * stdout / stderr 实时收集并推给界面 —— 报错信息必须当场看得到，
   * 否则用户只能猜「为什么没反应」。
   */
  async startProject(projectId: number): Promise<{ ok: boolean; error?: string }> {
    try {
      const existing = this.runtimes.get(projectId);
      if (existing && isAlive(existing.child)) {
        return { ok: false, error: "该项目已经在运行了" };
      }

      const project = await this.getProject(projectId);
      if (!project) return { ok: false, error: "项目不存在" };
      if (project.status !== "ready") {
        return { ok: false, error: project.error ?? "该项目尚未配置好" };
      }
      if (!project.command) {
        return { ok: false, error: "清单里没有 command，无法启动" };
      }

      const manifest = await this.readManifest(projectId);
      if (!manifest) return { ok: false, error: "读取清单失败" };

      // 工作目录：相对项目根解析，越界（../..）直接拒绝
      const cwd = resolveWithin(project.path, manifest.cwd || ".");
      if (!cwd) return { ok: false, error: "cwd 指向了项目目录之外" };
      if (!fs.existsSync(cwd)) return { ok: false, error: "工作目录不存在" };

      const commandLine = buildCommandLine(manifest);
      const env = { ...process.env, ...(manifest.env ?? {}) };

      const child = spawn(commandLine, {
        cwd,
        env,
        // 走 shell 才能执行 `node server.js`、`python main.py` 这类一行命令
        shell: true,
        windowsHide: true,
        // POSIX 下自成一个进程组，停止时才能连带杀掉子进程
        detached: process.platform !== "win32",
      });

      const state: AppRuntimeState = {
        projectId,
        status: "starting",
        pid: child.pid,
        startedAt: Date.now(),
      };
      this.runtimes.set(projectId, { child, state });

      const stdout = new LineSplitter(projectId, "stdout", (line) => this.pushLog(line));
      const stderr = new LineSplitter(projectId, "stderr", (line) => this.pushLog(line));

      /**
       * 进程真的起来了 → 状态从「启动中」切到「运行中」
       *
       * 不能只看有没有输出：vibe 项目里不打印东西的常驻服务很常见，
       * 那样界面会一直停在「启动中」，看着像没起来。
       */
      child.once("spawn", () => {
        this.markRunning(projectId);
      });

      child.stdout?.setEncoding("utf-8");
      child.stderr?.setEncoding("utf-8");
      child.stdout?.on("data", (chunk: string) => {
        stdout.push(chunk);
        this.markRunning(projectId);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr.push(chunk);
        this.markRunning(projectId);
      });

      child.on("error", (err) => {
        stdout.flush();
        stderr.flush();
        const current = this.runtimes.get(projectId);
        if (current) {
          current.state = {
            ...current.state,
            status: "failed",
            error: err.message,
            endedAt: Date.now(),
          };
          this.emitRuntime(current.state);
        }
        this.pushLog({
          projectId,
          stream: "system",
          text: `启动失败：${err.message}`,
          at: Date.now(),
        });
      });

      child.on("close", (code, signal) => {
        stdout.flush();
        stderr.flush();
        const current = this.runtimes.get(projectId);
        if (current) {
          const reason = signal ? `被信号 ${signal} 终止` : `退出码 ${code ?? 0}`;
          current.state = {
            ...current.state,
            status: "exited",
            exitCode: code ?? undefined,
            endedAt: Date.now(),
          };
          this.emitRuntime(current.state);
          this.pushLog({
            projectId,
            stream: "system",
            text: `进程已结束（${reason}）`,
            at: Date.now(),
          });
        }
      });

      this.pushLog({
        projectId,
        stream: "system",
        text: `已启动：${commandLine}`,
        at: Date.now(),
      });
      this.emitRuntime(state);

      return { ok: true };
    } catch (err) {
      log.error("[app] 启动项目失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 停止项目 */
  async stopProject(projectId: number): Promise<{ ok: boolean; error?: string }> {
    try {
      const entry = this.runtimes.get(projectId);
      if (!entry) return { ok: true };
      if (!isAlive(entry.child)) {
        this.runtimes.delete(projectId);
        return { ok: true };
      }

      const pid = entry.child.pid;
      if (pid) {
        if (process.platform === "win32") {
          // Windows 上 shell:true 拉起的是 cmd.exe，真正干活的是它的子进程。
          // 只 kill cmd.exe 会留下 node 在后台跑 —— /T 才是连树一起杀。
          await new Promise<void>((resolve) => {
            const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
              windowsHide: true,
            });
            killer.on("close", () => resolve());
            killer.on("error", () => resolve());
          });
        } else {
          // POSIX 下 detached 启动，进程组 id 就是 pid，负号杀整组
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            try {
              entry.child.kill("SIGTERM");
            } catch {
              /* 进程可能已经自己退了 */
            }
          }
        }
      }

      this.pushLog({
        projectId,
        stream: "system",
        text: "已请求停止",
        at: Date.now(),
      });
      return { ok: true };
    } catch (err) {
      log.error("[app] 停止项目失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 退出应用时把所有常驻进程收干净 */
  async disposeAll(): Promise<void> {
    const ids = [...this.runtimes.keys()];
    for (const id of ids) {
      await this.stopProject(id);
    }
  }

  /**
   * 退出时同步收进程
   *
   * 退出流程里没有时间等异步 IPC 往返 —— will-quit 一过去进程就结束了，
   * 异步 spawn 出来的 taskkill 还没来得及跑，子进程就被留成了孤儿：
   * 用户关掉 QNote，结果 dev server 还在后台占着端口。
   *
   * 所以这里用 spawnSync 阻塞式地杀，保证"关掉应用 = 进程真的停了"。
   */
  disposeAllSync(): void {
    for (const entry of this.runtimes.values()) {
      const pid = entry.child.pid;
      if (!pid || !isAlive(entry.child)) continue;
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            entry.child.kill("SIGKILL");
          }
        }
      } catch (err) {
        log.warn("[app] 退出时结束进程失败:", err);
      }
      // 标记成已退出而不是删掉条目 —— 退出流程里没人看这个状态，
      // 但删掉会让「进程已经结束」这件事在状态上凭空消失。
      entry.state = { ...entry.state, status: "exited", endedAt: Date.now() };
    }
  }

  private markRunning(projectId: number): void {
    const entry = this.runtimes.get(projectId);
    if (!entry) return;
    if (entry.state.status === "running") return;
    entry.state = { ...entry.state, status: "running" };
    this.emitRuntime(entry.state);
  }

  private pushLog(line: AppLogLine): void {
    const list = this.logs.get(line.projectId) ?? [];
    list.push(line);
    if (list.length > LOG_BUFFER_LIMIT) {
      list.splice(0, list.length - LOG_BUFFER_LIMIT);
    }
    this.logs.set(line.projectId, list);
    this.sink?.onLog(line);
  }

  private emitRuntime(state: AppRuntimeState): void {
    this.sink?.onRuntimeChanged(state);
  }

  private async broadcastProjects(): Promise<void> {
    this.sink?.onProjectsChanged(await this.listProjects());
  }

  /** 重新读一遍项目清单 —— 启动前要拿到最新的 cwd / env */
  private async readManifest(projectId: number): Promise<AppManifest | null> {
    const row = await this.DB("app_project").where("id", projectId).first();
    if (!row?.path) return null;
    const parsed = readManifestFromDir(row.path as string);
    return parsed.manifest;
  }
}

/**
 * 读一个目录的清单，解析成项目记录
 *
 * 单独抽出来是因为「导入时判断合不合规」和「刷新时更新已导入项目」
 * 要的是同一套判定 —— 两处口径不一致的话，界面上会出现
 * 「导入时说不合规、刷新后又说合规」这种自相矛盾的状态。
 */
export function readProjectRecord(dir: string): ProjectRecord {
  const parsed = readManifestFromDir(dir);
  const status: AppProjectStatus = parsed.manifest
    ? "ready"
    : parsed.missing
      ? "missing-manifest"
      : "invalid-manifest";

  const name = parsed.manifest?.name?.trim() || path.basename(dir) || dir;

  return {
    name,
    status,
    manifest_text: parsed.raw ?? null,
    command: parsed.manifest?.command ? buildCommandLine(parsed.manifest) : null,
    preview: parsed.manifest?.preview ?? null,
    description: parsed.manifest?.description ?? null,
    error: parsed.manifest ? null : parsed.error ?? "清单不可用",
  };
}

/** 子进程是否还活着 */
function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && !child.killed && child.signalCode === null;
}

/**
 * 把相对路径解析到项目目录内
 *
 * 返回 null 表示越界 —— `cwd: "../../.."` 这类写法不该把进程的工作目录
 * 指到项目外面去。
 */
export function resolveWithin(baseDir: string, relative: string): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relative);
  if (target === base) return base;
  if (target.startsWith(base + path.sep)) return target;
  return null;
}
