import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Knex } from "knex";
import { log } from "../system/log";
import { describeDBError } from "../../../database/index";
import {
  APP_MANIFEST_FILENAME,
  buildCommandLine,
  parseManifestText,
  readManifestFromDir,
} from "../../utils/appManifest";
import type {
  AppImportResult,
  AppLogLine,
  AppLogStream,
  AppManifest,
  AppOrigin,
  AppProject,
  AppProjectStatus,
  AppRuntimeState,
  StartConfirmation,
} from "../../../shared/apps/appTypes";
import { analyzeCommand } from "../../../shared/apps/appRisk";
import { contentHash } from "../../../shared/notes/noteHash";


const LOG_BUFFER_LIMIT = 400;

export interface AppEventSink {
  onProjectsChanged(projects: AppProject[]): void;
  onRuntimeChanged(state: AppRuntimeState): void;
  onLog(line: AppLogLine): void;
}

interface RuntimeEntry {
  child: ChildProcess;
  state: AppRuntimeState;
}

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

interface ProjectRecord {
  name: string;
  status: AppProjectStatus;
  manifest_text: string | null;
  command: string | null;
  preview: string | null;
  description: string | null;
  error: string | null;
}

function taskkillPath(): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(root, "System32", "taskkill.exe");
}

export class AppManager {
  private sink: AppEventSink | null = null;
  private runtimes = new Map<number, RuntimeEntry>();
  private logs = new Map<number, AppLogLine[]>();
  private projectDirs = new Map<number, string>();

  constructor(private readonly DB: Knex) {}

  setEventSink(sink: AppEventSink): void {
    this.sink = sink;
  }


  async importProject(
    dirPath: string,
    origin: AppOrigin = "local"
  ): Promise<AppImportResult> {
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
        origin,
        confirmed_manifest_hash: "",
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
      origin: (row.origin as AppOrigin) ?? "local",
      confirmedManifestHash: row.confirmed_manifest_hash || undefined,
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

  getProjectDirSync(id: number): string | null {
    return this.projectDirs.get(id) ?? null;
  }

  async importFromMarket(
    dirPath: string,
    payload: Partial<AppManifest>
  ): Promise<AppImportResult> {
    try {
      const dir = path.resolve(String(dirPath ?? "").trim());
      if (!dir) return { ok: false, error: "目录不能为空", reason: "not-a-directory" };
      if (!fs.existsSync(dir)) {
        return { ok: false, error: "目录不存在", reason: "not-a-directory" };
      }
      if (!fs.statSync(dir).isDirectory()) {
        return { ok: false, error: "选中的不是文件夹", reason: "not-a-directory" };
      }

      const manifestPath = path.join(dir, APP_MANIFEST_FILENAME);
      if (fs.existsSync(manifestPath)) {
        return {
          ok: false,
          error: "这个文件夹里已经有 qnote.json 了，没有覆盖它。请换一个空文件夹",
          reason: "already-imported",
        };
      }

      const existing = await this.DB("app_project").where("path", dir).first();
      if (existing) {
        return {
          ok: false,
          error: "这个项目已经导入了",
          reason: "already-imported",
        };
      }

      const written = await this.writeManifest(dir, payload);
      if (!written.ok) {
        return { ok: false, error: written.error, reason: "invalid-manifest" };
      }

      const imported = await this.importProject(dir, "market");
      if (!imported.ok) {
        try {
          fs.unlinkSync(manifestPath);
        } catch {
        }
        return imported;
      }
      return imported;
    } catch (err) {
      log.error("[app] 从市场导入项目失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  async checkStartConfirmation(projectId: number): Promise<StartConfirmation | null> {
    const project = await this.getProject(projectId);
    if (!project) return null;
    if ((project.origin ?? "local") !== "market") return null;

    const manifest = await this.readManifest(projectId);
    if (!manifest) return null;

    const manifestHash = this.manifestHashOf(project.path);
    if ((project.confirmedManifestHash ?? "") === manifestHash) return null;

    return {
      projectId,
      name: project.name,
      commandLine: buildCommandLine(manifest),
      origin: "market",
      risk: analyzeCommand(manifest.command ?? "", manifest.args ?? []),
      manifestHash,
      sourceLabel: project.description,
    };
  }

  async confirmStart(projectId: number, manifestHash: string): Promise<boolean> {
    if (!manifestHash) return false;
    const project = await this.getProject(projectId);
    if (!project) return false;

    const current = this.manifestHashOf(project.path);
    if (manifestHash !== current) return false;

    await this.DB("app_project")
      .where("id", projectId)
      .update({
        confirmed_manifest_hash: current,
        updated_at: new Date(),
      });
    return true;
  }

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

      fs.writeFileSync(path.join(dir, APP_MANIFEST_FILENAME), text, "utf-8"); // NOSONAR
      return { ok: true };
    } catch (err) {
      log.error("[app] 写入清单失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }


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

  clearLogs(projectId: number): void {
    this.logs.set(projectId, []);
  }

  async startProject(
    projectId: number,
    confirmedManifestHash?: string
  ): Promise<{
    ok: boolean;
    error?: string;
    needsConfirmation?: StartConfirmation;
  }> {
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

      const cwd = resolveWithin(project.path, manifest.cwd || ".");
      if (!cwd) return { ok: false, error: "cwd 指向了项目目录之外" };
      if (!fs.existsSync(cwd)) return { ok: false, error: "工作目录不存在" };

      const commandLine = buildCommandLine(manifest);

      if ((project.origin ?? "local") === "market") {
        if (confirmedManifestHash) {
          await this.confirmStart(projectId, confirmedManifestHash);
        }
        const confirmation = await this.checkStartConfirmation(projectId);
        if (confirmation) {
          return { ok: false, needsConfirmation: confirmation };
        }
      }

      const env = { ...process.env, ...(manifest.env ?? {}) };

      const child = spawn(commandLine, {
        cwd,
        env,
        shell: true,
        windowsHide: true,
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
          await new Promise<void>((resolve) => {
            const killer = spawn(taskkillPath(), ["/pid", String(pid), "/T", "/F"], {
              windowsHide: true,
            });
            killer.on("close", () => resolve());
            killer.on("error", () => resolve());
          });
        } else {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            try {
              entry.child.kill("SIGTERM");
            } catch {
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

  async disposeAll(): Promise<void> {
    const ids = [...this.runtimes.keys()];
    for (const id of ids) {
      await this.stopProject(id);
    }
  }

  disposeAllSync(): void {
    for (const entry of this.runtimes.values()) {
      const pid = entry.child.pid;
      if (!pid || !isAlive(entry.child)) continue;
      try {
        if (process.platform === "win32") {
          spawnSync(taskkillPath(), ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
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

  private async readManifest(projectId: number): Promise<AppManifest | null> {
    const row = await this.DB("app_project").where("id", projectId).first();
    if (!row?.path) return null;
    const parsed = readManifestFromDir(row.path as string);
    return parsed.manifest;
  }

  private manifestHashOf(projectPath: string): string {
    try {
      const file = path.join(projectPath, APP_MANIFEST_FILENAME);
      return contentHash(fs.readFileSync(file, "utf-8"));
    } catch {
      return "";
    }
  }
}

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

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && !child.killed && child.signalCode === null;
}

export function resolveWithin(baseDir: string, relative: string): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relative);
  if (target === base) return base;
  if (target.startsWith(base + path.sep)) return target;
  return null;
}
