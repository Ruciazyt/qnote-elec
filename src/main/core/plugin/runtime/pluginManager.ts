import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Knex } from "knex";
import { log } from "../../system/log";
import { describeDBError } from "../../../../database/index";
import {
  PLUGIN_MANIFEST_FILENAME,
  readPluginManifestFromDir,
  writePluginManifestToDir,
} from "../manifest/pluginManifest";
import {
  buildPluginCommandLine,
  satisfiesRange,
} from "../../../../shared/plugin/manifest/pluginManifest";
import { previewToDraftText } from "../../../../shared/plugin/manifest/pluginPreview";
import type {
  MarketImportPayload,
  PluginCapabilities,
  PluginContributes,
  PluginImportResult,
  PluginLogLine,
  PluginLogStream,
  PluginManifest,
  PluginManifestDraft,
  PluginOrigin,
  PluginRecord,
  PluginRuntimeConfig,
  PluginRuntimeState,
  PluginRunStatus,
  PluginStatus,
  PluginGrantRecord,
  StartConfirmation,
} from "../../../../shared/plugin/manifest/pluginTypes";
import { analyzeCommand } from "../permissions/nativePlugin";
import { contentHash } from "../../notes/nativeNotes";
import { unpackProjectBundle } from "./bundle";
import { checkCapability, grantKeyForRequest } from "../permissions/capabilities";
import {
  isGrantActive,
  listPluginGrants,
  setPluginGrant,
  syncPluginGrants,
} from "../permissions/pluginGrants";
import {
  checkPluginDependencies,
  formatDependencyIssues,
} from "../dependencies/pluginDependencies";
import { grantKeysForCapabilities } from "../../../../shared/plugin/permissions/pluginCapabilities";
import { PluginRpcServer } from "../sdk/rpcServer";
import { PluginHostApi } from "../sdk/hostApi";

const LOG_BUFFER_LIMIT = 400;

export interface PluginEventSink {
  onPluginsChanged(plugins: PluginRecord[]): void;
  onRuntimeChanged(state: PluginRuntimeState): void;
  onLog(line: PluginLogLine): void;
  onNotify(pluginId: string, level: string, message: string): void;
}

export interface PluginCommandEntry {
  command: string;
  title: string;
  category?: string;
  pluginId: string;
}

interface RuntimeEntry {
  child: ChildProcess;
  state: PluginRuntimeState;
  stopping: boolean;
}

class LineSplitter {
  private buffer = "";

  constructor(
    private readonly pluginId: string,
    private readonly stream: PluginLogStream,
    private readonly emit: (line: PluginLogLine) => void
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
      pluginId: this.pluginId,
      stream: this.stream,
      text,
      at: Date.now(),
    });
  }
}

export interface PluginDbRecord {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string | null;
  status: PluginStatus;
  manifest_text: string | null;
  command: string | null;
  preview: string | null;
  error: string | null;
  runtime_json: string | null;
  capabilities_json: string | null;
  contributes_json: string | null;
}

function taskkillPath(): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(root, "System32", "taskkill.exe");
}

export function readPluginRecord(dir: string, hostVersion: string): PluginDbRecord {
  const parsed = readPluginManifestFromDir(dir);

  if (!parsed.manifest) {
    return {
      id: "",
      name: path.basename(dir) || dir,
      version: "0.0.0",
      publisher: "",
      description: null,
      status: parsed.missing ? "missing-manifest" : "invalid-manifest",
      manifest_text: parsed.raw ?? null,
      command: null,
      preview: null,
      error: parsed.error ?? "清单不可用",
      runtime_json: null,
      capabilities_json: null,
      contributes_json: null,
    };
  }

  const manifest = parsed.manifest;
  const compatible = satisfiesRange(hostVersion, manifest.engines.qnote);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    publisher: manifest.publisher,
    description: manifest.description ?? null,
    status: compatible ? "ready" : "incompatible",
    manifest_text: parsed.raw ?? null,
    command: manifest.runtime.command ? buildPluginCommandLine(manifest.runtime) : null,
    preview: previewToDraftText(manifest.runtime.preview) || null,
    error: compatible
      ? null
      : `这个插件与当前 QNote 版本不兼容：它要求 ${manifest.engines.qnote}，当前版本是 ${hostVersion}`,
    runtime_json: JSON.stringify(manifest.runtime),
    capabilities_json: manifest.capabilities ? JSON.stringify(manifest.capabilities) : null,
    contributes_json: manifest.contributes ? JSON.stringify(manifest.contributes) : null,
  };
}

export class PluginManager {
  private sink: PluginEventSink | null = null;
  private runtimes = new Map<string, RuntimeEntry>();
  private logs = new Map<string, PluginLogLine[]>();
  private pluginDirs = new Map<string, string>();
  private localIdDirs = new Map<number, string>();
  private hostVersion = "0.0.0";

  private readonly rpcServer: PluginRpcServer;
  private readonly hostApi: PluginHostApi;
  private readonly commandOwners = new Map<string, PluginCommandEntry>();

  constructor(readonly DB: Knex) {
    this.hostApi = new PluginHostApi(this);
    this.rpcServer = new PluginRpcServer({
      handlePluginCall: (session, method, params) =>
        this.hostApi.handlePluginCall(session, method, params),
      onPluginEvent: () => {
      },
    });
  }

  setHostVersion(version: string): void {
    this.hostVersion = version;
  }

  getHostVersion(): string {
    return this.hostVersion;
  }

  setEventSink(sink: PluginEventSink): void {
    this.sink = sink;
  }

  listCommands(): PluginCommandEntry[] {
    return [...this.commandOwners.values()];
  }

  async executeCommand(command: string): Promise<unknown> {
    const entry = this.commandOwners.get(command);
    if (!entry) throw new Error(`没有这个命令：${command}`);
    return await this.rpcServer.callPlugin(entry.pluginId, "qnote.command.invoke", {
      command,
    });
  }

  notifyPlugin(pluginId: string, level: string, message: string): void {
    this.sink?.onNotify(pluginId, level, message);
  }

  logFromPlugin(pluginId: string, level: string, message: string): void {
    const stream: PluginLogStream = level === "error" ? "stderr" : "stdout";
    this.pushLog({ pluginId, stream, text: message, at: Date.now() });
  }

  private registerStaticCommands(plugin: PluginRecord): void {
    for (const contributed of plugin.contributes?.commands ?? []) {
      this.commandOwners.set(contributed.command, {
        command: contributed.command,
        title: contributed.title,
        category: contributed.category,
        pluginId: plugin.id,
      });
    }
  }

  private clearPluginCommands(pluginId: string): void {
    for (const [command, entry] of this.commandOwners) {
      if (entry.pluginId === pluginId) this.commandOwners.delete(command);
    }
  }

  private async activatePlugin(pluginId: string): Promise<void> {
    const registered = await this.rpcServer.waitForCallback(pluginId, 5000);
    if (!registered) {
      const state = this.getRuntimeState(pluginId);
      if (!state || state.status !== "activating") return;
      this.setRunStatus(pluginId, "active");
      this.pushLog({
        pluginId,
        stream: "system",
        text: "这个插件没有接入 SDK，按普通程序运行",
        at: Date.now(),
      });
      log.info(`[plugin] ${pluginId} 没有接入 SDK，按普通程序运行`);
      return;
    }

    try {
      const result = (await this.rpcServer.callPlugin(
        pluginId,
        "plugin.activate",
        {},
        5000
      )) as { commands?: string[] } | null;
      const commands = result?.commands ?? [];
      for (const command of commands) {
        if (!this.commandOwners.has(command)) {
          this.commandOwners.set(command, {
            command,
            title: command,
            pluginId,
          });
        }
      }
      this.setRunStatus(pluginId, "active");
      log.info(`[plugin] ${pluginId} 已激活`, { commands });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.setRunStatus(pluginId, "failed", `SDK 握手失败：${reason}`);
      this.pushLog({
        pluginId,
        stream: "system",
        text: `SDK 握手失败：${reason}`,
        at: Date.now(),
      });
    }
  }

  async importPlugin(
    dirPath: string,
    origin: PluginOrigin = "local"
  ): Promise<PluginImportResult> {
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

      const existing = await this.DB("plugin").where("path", dir).first();
      if (existing) {
        return {
          ok: false,
          error: "这个插件已经导入了",
          reason: "already-imported",
        };
      }

      const record = readPluginRecord(dir, this.hostVersion);
      if (record.status !== "ready" && record.status !== "incompatible") {
        return {
          ok: false,
          error: record.error ?? "这个文件夹不符合插件规范",
          reason:
            record.status === "missing-manifest" ? "missing-manifest" : "invalid-manifest",
        };
      }

      const duplicated = await this.DB("plugin").where("id", record.id).first();
      if (duplicated) {
        return {
          ok: false,
          error: `已经有一个 id 相同的插件了（${record.id}）`,
          reason: "duplicate-id",
        };
      }

      await this.DB("plugin").insert({
        ...record,
        path: dir,
        origin,
        enabled: 1,
        confirmed_manifest_hash: "",
        sort_order: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
      this.pluginDirs.set(record.id, dir);
      await syncPluginGrants(
        this.DB,
        record.id,
        parseJson<PluginCapabilities>(record.capabilities_json)
      );

      const plugin = await this.getPlugin(record.id);
      await this.broadcastPlugins();
      return { ok: true, plugin: plugin ?? undefined };
    } catch (err) {
      log.error("[plugin] 导入插件失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  async removePlugin(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.stopPlugin(id);
      await this.DB("plugin").where("id", id).delete();
      await this.DB("plugin_setting").where("plugin_id", id).delete();
      await this.DB("plugin_grant").where("plugin_id", id).delete();
      this.pluginDirs.delete(id);
      this.logs.delete(id);
      await this.broadcastPlugins();
      return { ok: true };
    } catch (err) {
      log.error("[plugin] 移除插件失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    try {
      const plugin = await this.getPlugin(id);
      if (!plugin) return { ok: false, error: "插件不存在" };
      if (!enabled) await this.stopPlugin(id);
      await this.DB("plugin")
        .where("id", id)
        .update({ enabled: enabled ? 1 : 0, updated_at: new Date() });
      await this.broadcastPlugins();
      return { ok: true };
    } catch (err) {
      log.error("[plugin] 启用/禁用插件失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  async refreshPlugins(): Promise<PluginRecord[]> {
    try {
      const rows = await this.DB("plugin").select("*");
      for (const row of rows) {
        const record = readPluginRecord(row.path as string, this.hostVersion);
        await this.DB("plugin")
          .where("id", row.id)
          .update({ ...record, updated_at: new Date() });
        await syncPluginGrants(
          this.DB,
          String(row.id),
          parseJson<PluginCapabilities>(record.capabilities_json)
        );
      }
      await this.broadcastPlugins();
      return await this.listPlugins();
    } catch (err) {
      log.error("[plugin] 刷新插件清单失败:", err);
      return [];
    }
  }

  async listPlugins(): Promise<PluginRecord[]> {
    try {
      const rows = await this.DB("plugin")
        .select("*")
        .orderBy("sort_order", "asc")
        .orderBy("name", "asc");
      for (const row of rows) {
        this.pluginDirs.set(row.id as string, row.path as string);
        this.localIdDirs.set(Number(row.local_id), row.path as string);
      }
      const plugins = rows.map((row) => toPluginRecord(row));
      for (const plugin of plugins) {
        this.registerStaticCommands(plugin);
      }
      return plugins;
    } catch (err) {
      log.error("[plugin] 读取插件列表失败:", err);
      return [];
    }
  }

  async getPlugin(id: string): Promise<PluginRecord | null> {
    try {
      const row = await this.DB("plugin").where("id", id).first();
      if (!row) return null;
      this.pluginDirs.set(row.id as string, row.path as string);
      this.localIdDirs.set(Number(row.local_id), row.path as string);
      return toPluginRecord(row);
    } catch (err) {
      log.error("[plugin] 读取插件失败:", err);
      return null;
    }
  }

  getPluginDirSync(id: string): string | null {
    return this.pluginDirs.get(id) ?? null;
  }

  async getPluginByLocalId(localId: number): Promise<PluginRecord | null> {
    try {
      const row = await this.DB("plugin").where("local_id", localId).first();
      if (!row) return null;
      return toPluginRecord(row);
    } catch (err) {
      log.error("[plugin] 按本地号读取插件失败:", err);
      return null;
    }
  }

  getPluginDirByLocalId(localId: number): string | null {
    return this.localIdDirs.get(localId) ?? null;
  }

  async importFromMarket(
    dirPath: string,
    payload: MarketImportPayload
  ): Promise<PluginImportResult> {
    try {
      const dir = path.resolve(String(dirPath ?? "").trim());
      if (!dir) return { ok: false, error: "目录不能为空", reason: "not-a-directory" };
      if (!fs.existsSync(dir)) {
        return { ok: false, error: "目录不存在", reason: "not-a-directory" };
      }
      if (!fs.statSync(dir).isDirectory()) { // NOSONAR 目录是用户在系统对话框里挑的插件目录，污点分析认不出这层约束
        return { ok: false, error: "选中的不是文件夹", reason: "not-a-directory" };
      }

      const manifestPath = path.join(dir, PLUGIN_MANIFEST_FILENAME);
      if (fs.existsSync(manifestPath)) {
        return {
          ok: false,
          error: `这个文件夹里已经有 ${PLUGIN_MANIFEST_FILENAME} 了，没有覆盖它。请换一个空文件夹`,
          reason: "already-imported",
        };
      }

      const existing = await this.DB("plugin").where("path", dir).first();
      if (existing) {
        return {
          ok: false,
          error: "这个插件已经导入了",
          reason: "already-imported",
        };
      }

      const written = this.writeMarketManifest(dir, payload);
      if (!written.ok) {
        return { ok: false, error: written.error, reason: "invalid-manifest" };
      }

      const imported = await this.importPlugin(dir, "market");
      if (!imported.ok) {
        try {
          fs.unlinkSync(manifestPath); // NOSONAR 删的是本次刚写进去的清单，写之前已确认目标不存在
        } catch {
        }
        return imported;
      }

      if (payload.bundle) {
        try {
          unpackProjectBundle(dir, payload.bundle);
        } catch (err) {
          log.error("[plugin] 解开资源包失败:", err);
          return {
            ok: false,
            error: `清单已经装好，但资源包解开失败：${err instanceof Error ? err.message : String(err)}`,
            reason: "invalid-manifest",
          };
        }
      }

      return imported;
    } catch (err) {
      log.error("[plugin] 从市场导入插件失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  async upgradeFromMarket(
    pluginId: string,
    payload: MarketImportPayload
  ): Promise<PluginImportResult> {
    try {
      const plugin = await this.getPlugin(pluginId);
      if (!plugin) {
        return {
          ok: false,
          error: "这个插件没装在本机",
          reason: "missing-manifest",
        };
      }
      if ((plugin.origin ?? "local") !== "market") {
        return { ok: false, error: "只有从市场装来的插件才能升级" };
      }

      const publishedId = payload.id?.trim();
      if (publishedId && publishedId !== plugin.id) {
        return {
          ok: false,
          error: "发布记录的 id 和本机装的不是同一个插件",
        };
      }

      const dir = plugin.path;
      if (!fs.existsSync(dir)) {
        return {
          ok: false,
          error: "插件目录不在了",
          reason: "missing-manifest",
        };
      }

      const stopped = await this.stopPlugin(pluginId);
      if (!stopped.ok) {
        return {
          ok: false,
          error: stopped.error ?? "插件还在运行，停掉之后才能升级",
        };
      }

      const written = this.writeMarketManifest(dir, payload);
      if (!written.ok) {
        return { ok: false, error: written.error, reason: "invalid-manifest" };
      }

      if (payload.bundle) {
        try {
          unpackProjectBundle(dir, payload.bundle);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          log.error("[plugin] 升级时解开资源包失败:", err);
          return {
            ok: false,
            error: `清单已经更新，但资源包解开失败：${reason}`,
          };
        }
      }

      const fresh = readPluginRecord(dir, this.hostVersion);
      if (fresh.status !== "ready" && fresh.status !== "incompatible") {
        return {
          ok: false,
          error: fresh.error ?? "升级后的清单不合法",
          reason: "invalid-manifest",
        };
      }

      await this.DB("plugin")
        .where("id", plugin.id)
        .update({
          ...fresh,
          confirmed_manifest_hash: "",
          updated_at: new Date(),
        });
      await syncPluginGrants(
        this.DB,
        plugin.id,
        parseJson<PluginCapabilities>(fresh.capabilities_json)
      );

      const updated = await this.getPlugin(plugin.id);
      await this.broadcastPlugins();
      return { ok: true, plugin: updated ?? undefined };
    } catch (err) {
      log.error("[plugin] 升级市场插件失败:", err);
      return { ok: false, error: describeDBError(err) };
    }
  }

  async checkStartConfirmation(pluginId: string): Promise<StartConfirmation | null> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) return null;
    if ((plugin.origin ?? "local") !== "market") return null;

    const manifest = await this.readManifest(pluginId);
    if (!manifest) return null;

    const manifestHash = this.manifestHashOf(plugin.path);
    if ((plugin.confirmedManifestHash ?? "") === manifestHash) return null;

    return {
      pluginId,
      name: plugin.name,
      commandLine: buildPluginCommandLine(manifest.runtime),
      origin: "market",
      risk: analyzeCommand(
        manifest.runtime.command ?? "",
        manifest.runtime.args ?? []
      ),
      manifestHash,
      sourceLabel: plugin.description,
      capabilities: manifest.capabilities,
    };
  }

  async confirmStart(pluginId: string, manifestHash: string): Promise<boolean> {
    if (!manifestHash) return false;
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) return false;

    const current = this.manifestHashOf(plugin.path);
    if (manifestHash !== current) return false;

    await this.DB("plugin")
      .where("id", pluginId)
      .update({
        confirmed_manifest_hash: current,
        updated_at: new Date(),
      });
    return true;
  }

  async writeManifest(
    pluginPath: string,
    payload: PluginManifestDraft
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const dir = path.resolve(pluginPath);
      if (!fs.existsSync(dir)) return { ok: false, error: "插件目录不存在" };
      if (!fs.statSync(dir).isDirectory()) return { ok: false, error: "插件路径不是文件夹" }; // NOSONAR 目录是用户挑的插件目录，拼接段是常量

      const existing = readPluginManifestFromDir(dir).manifest;
      const manifest = this.mergeManifest(existing, payload);
      if (!manifest) {
        return { ok: false, error: "清单里缺少必填项（id、name、version、publisher、engines）" };
      }

      const written = writePluginManifestToDir(dir, manifest);
      if (!written.ok) return written;

      const row = await this.DB("plugin").where("path", dir).first();
      if (row) {
        const fresh = readPluginManifestFromDir(dir).manifest;
        await syncPluginGrants(
          this.DB,
          String(row.id),
          fresh
            ? fresh.capabilities
            : parseJson<PluginCapabilities>(row.capabilities_json)
        );
      }
      return { ok: true };
    } catch (err) {
      log.error("[plugin] 写入清单失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getRuntimeStates(): PluginRuntimeState[] {
    const states: PluginRuntimeState[] = [];
    for (const [pluginId, entry] of this.runtimes) {
      states.push({ ...entry.state, pluginId });
    }
    return states;
  }

  getRuntimeState(pluginId: string): PluginRuntimeState | null {
    const entry = this.runtimes.get(pluginId);
    return entry ? { ...entry.state, pluginId } : null;
  }

  getLogs(pluginId: string): PluginLogLine[] {
    return [...(this.logs.get(pluginId) ?? [])];
  }

  clearLogs(pluginId: string): void {
    this.logs.set(pluginId, []);
  }

  async listGrants(pluginId: string): Promise<PluginGrantRecord[]> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) return [];
    const capabilities =
      (await this.currentCapabilities(pluginId)) ?? plugin.capabilities;
    return await listPluginGrants(this.DB, pluginId, capabilities);
  }

  async setGrant(
    pluginId: string,
    capability: string,
    granted: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) return { ok: false, error: "插件不存在" };
    const capabilities =
      (await this.currentCapabilities(pluginId)) ?? plugin.capabilities;
    if (!grantKeysForCapabilities(capabilities).includes(capability)) {
      return { ok: false, error: "这个插件没有声明这项权限" };
    }
    return await setPluginGrant(this.DB, pluginId, capability, granted);
  }

  private async currentCapabilities(
    pluginId: string
  ): Promise<PluginCapabilities | undefined> {
    const manifest = await this.readManifest(pluginId);
    if (manifest) return manifest.capabilities;
    const plugin = await this.getPlugin(pluginId);
    return plugin?.capabilities;
  }

  private async checkDependencies(
    dependencies?: string[]
  ): Promise<{ ok: boolean; error?: string }> {
    if (!dependencies || dependencies.length === 0) return { ok: true };
    const rows = await this.DB("plugin").select("id", "version");
    const installed = new Map(
      rows.map(
        (row) =>
          [String(row.id), String(row.version ?? "0.0.0")] as [string, string]
      )
    );
    const report = checkPluginDependencies(dependencies, installed);
    if (report.ok) return { ok: true };
    return { ok: false, error: formatDependencyIssues(report.issues) };
  }

  async startPlugin(
    pluginId: string,
    confirmedManifestHash?: string
  ): Promise<{
    ok: boolean;
    error?: string;
    needsConfirmation?: StartConfirmation;
  }> {
    try {
      const existing = this.runtimes.get(pluginId);
      if (existing && isAlive(existing.child)) {
        return { ok: false, error: "这个插件已经在运行了" };
      }

      const plugin = await this.getPlugin(pluginId);
      if (!plugin) return { ok: false, error: "插件不存在" };
      if (!plugin.enabled) return { ok: false, error: "这个插件已被禁用" };
      if (plugin.status === "incompatible") {
        return { ok: false, error: plugin.error ?? "这个插件与当前 QNote 版本不兼容" };
      }
      if (plugin.status !== "ready") {
        return { ok: false, error: plugin.error ?? "这个插件尚未配置好" };
      }

      const manifest = await this.readManifest(pluginId);
      if (!manifest) return { ok: false, error: "读取清单失败" };
      if (!manifest.runtime.command) {
        return { ok: false, error: "清单里没有 command，无法启动" };
      }

      const decision = checkCapability(manifest.capabilities, { kind: "spawn" });
      if (!decision.allowed) {
        return { ok: false, error: decision.reason };
      }

      const spawnGranted = await isGrantActive(
        this.DB,
        pluginId,
        grantKeyForRequest({ kind: "spawn" })
      );
      if (!spawnGranted) {
        return { ok: false, error: "这个插件的「启动子进程」权限已被撤销" };
      }

      const dependencyCheck = await this.checkDependencies(
        manifest.extensionDependencies
      );
      if (!dependencyCheck.ok) {
        return { ok: false, error: dependencyCheck.error };
      }

      const cwd = resolveWithin(plugin.path, manifest.runtime.cwd || ".");
      if (!cwd) return { ok: false, error: "cwd 指向了插件目录之外" };
      if (!fs.existsSync(cwd)) return { ok: false, error: "工作目录不存在" };

      const commandLine = buildPluginCommandLine(manifest.runtime);

      if ((plugin.origin ?? "local") === "market") {
        if (confirmedManifestHash) {
          await this.confirmStart(pluginId, confirmedManifestHash);
        }
        const confirmation = await this.checkStartConfirmation(pluginId);
        if (confirmation) {
          return { ok: false, needsConfirmation: confirmation };
        }
      }

      await this.rpcServer.ensureStarted();
      const session = this.rpcServer.createSession(pluginId, manifest);

      const env = {
        ...process.env,
        ...(manifest.runtime.env ?? {}),
        QNOTE_PLUGIN_RPC: this.rpcServer.endpoint,
        QNOTE_PLUGIN_TOKEN: session.token,
        QNOTE_PLUGIN_ID: manifest.id,
        QNOTE_PLUGIN_VERSION: manifest.version,
      };

      // eslint-disable-next-line sonarjs/os-command -- command 取自插件自己的 plugin.json，市场来源另有风险分析与启动确认
      const child = spawn(commandLine, { // NOSONAR
        cwd,
        env,
        shell: true,
        windowsHide: true,
        detached: process.platform !== "win32",
      });

      const state: PluginRuntimeState = {
        pluginId,
        status: "activating",
        pid: child.pid,
        startedAt: Date.now(),
      };
      this.runtimes.set(pluginId, { child, state, stopping: false });

      const stdout = new LineSplitter(pluginId, "stdout", (line) => this.pushLog(line));
      const stderr = new LineSplitter(pluginId, "stderr", (line) => this.pushLog(line));

      child.stdout?.setEncoding("utf-8");
      child.stderr?.setEncoding("utf-8");
      child.stdout?.on("data", (chunk: string) => {
        stdout.push(chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr.push(chunk);
      });

      child.on("error", (err) => {
        stdout.flush();
        stderr.flush();
        this.rpcServer.destroySession(pluginId);
        this.clearPluginCommands(pluginId);
        const current = this.runtimes.get(pluginId);
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
          pluginId,
          stream: "system",
          text: `启动失败：${err.message}`,
          at: Date.now(),
        });
      });

      child.on("close", (code, signal) => {
        stdout.flush();
        stderr.flush();
        const current = this.runtimes.get(pluginId);
        if (current) {
          const reason = signal ? `被信号 ${signal} 终止` : `退出码 ${code ?? 0}`;
          const stopped = current.stopping;
          const abnormal = !stopped && (signal !== null || (code ?? 0) !== 0);
          current.state = {
            ...current.state,
            status: abnormal ? "failed" : "inactive",
            exitCode: code ?? undefined,
            endedAt: Date.now(),
            error: abnormal ? `进程异常结束（${reason}）` : undefined,
          };
          this.emitRuntime(current.state);
          this.pushLog({
            pluginId,
            stream: "system",
            text: abnormal
              ? `进程异常结束（${reason}）`
              : `进程已结束（${reason}）`,
            at: Date.now(),
          });
        }
      });

      this.pushLog({
        pluginId,
        stream: "system",
        text: `已启动：${commandLine}`,
        at: Date.now(),
      });
      this.emitRuntime(state);
      void this.activatePlugin(pluginId);

      return { ok: true };
    } catch (err) {
      log.error("[plugin] 启动插件失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async stopPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const entry = this.runtimes.get(pluginId);
      if (!entry) {
        this.rpcServer.destroySession(pluginId);
        this.clearPluginCommands(pluginId);
        return { ok: true };
      }
      if (!isAlive(entry.child)) {
        this.runtimes.delete(pluginId);
        this.rpcServer.destroySession(pluginId);
        this.clearPluginCommands(pluginId);
        return { ok: true };
      }

      const pid = entry.child.pid;
      entry.stopping = true;
      entry.state = { ...entry.state, status: "deactivating" };
      this.emitRuntime(entry.state);

      if (this.rpcServer.isConnected(pluginId)) {
        try {
          await this.rpcServer.callPlugin(pluginId, "plugin.deactivate", {}, 5000);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.pushLog({
            pluginId,
            stream: "system",
            text: `插件没有完成收尾，直接结束进程：${reason}`,
            at: Date.now(),
          });
        }
      }

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

      this.rpcServer.destroySession(pluginId);
      this.clearPluginCommands(pluginId);

      this.pushLog({
        pluginId,
        stream: "system",
        text: "已请求停止",
        at: Date.now(),
      });
      return { ok: true };
    } catch (err) {
      log.error("[plugin] 停止插件失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async disposeAll(): Promise<void> {
    const ids = [...this.runtimes.keys()];
    for (const id of ids) {
      await this.stopPlugin(id);
    }
  }

  async dispose(): Promise<void> {
    await this.disposeAll();
    await this.rpcServer.dispose();
    this.commandOwners.clear();
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
        log.warn("[plugin] 退出时结束进程失败:", err);
      }
      entry.state = { ...entry.state, status: "inactive", endedAt: Date.now() };
    }
  }

  private setRunStatus(
    pluginId: string,
    status: PluginRunStatus,
    error?: string
  ): void {
    const entry = this.runtimes.get(pluginId);
    if (!entry) return;
    entry.state = {
      ...entry.state,
      status,
      error: error === undefined ? entry.state.error : error,
    };
    this.emitRuntime(entry.state);
  }

  private pushLog(line: PluginLogLine): void {
    const list = this.logs.get(line.pluginId) ?? [];
    list.push(line);
    if (list.length > LOG_BUFFER_LIMIT) {
      list.splice(0, list.length - LOG_BUFFER_LIMIT);
    }
    this.logs.set(line.pluginId, list);
    this.sink?.onLog(line);
  }

  private emitRuntime(state: PluginRuntimeState): void {
    this.sink?.onRuntimeChanged(state);
  }

  private async broadcastPlugins(): Promise<void> {
    this.sink?.onPluginsChanged(await this.listPlugins());
  }

  private async readManifest(pluginId: string): Promise<PluginManifest | null> {
    const row = await this.DB("plugin").where("id", pluginId).first();
    if (!row?.path) return null;
    return readPluginManifestFromDir(row.path as string).manifest;
  }

  private manifestHashOf(pluginPath: string): string {
    try {
      const file = path.join(pluginPath, PLUGIN_MANIFEST_FILENAME);
      return contentHash(fs.readFileSync(file, "utf-8"));
    } catch {
      return "";
    }
  }

  private mergeManifest(
    existing: PluginManifest | null,
    payload: PluginManifestDraft
  ): PluginManifest | null {
    const name = payload.name?.trim() || existing?.name;
    const id = payload.id?.trim() || existing?.id;
    const version = payload.version?.trim() || existing?.version || "0.0.1";
    const publisher = payload.publisher?.trim() || existing?.publisher || "local";
    const enginesQnote =
      payload.engines?.qnote?.trim() ||
      existing?.engines.qnote ||
      `^${this.hostVersion.split(".").slice(0, 2).join(".")}.0`;

    if (!name || !id) return null;

    const runtime: PluginRuntimeConfig = payload.runtime ?? existing?.runtime ?? {};
    const capabilities: PluginCapabilities | undefined =
      payload.capabilities ?? existing?.capabilities;
    const contributes: PluginContributes | undefined =
      payload.contributes ?? existing?.contributes;

    const manifest: PluginManifest = {
      id,
      name,
      version,
      publisher,
      engines: { qnote: enginesQnote },
      runtime,
    };

    const description = payload.description?.trim() ?? existing?.description;
    if (description) manifest.description = description;
    const license = payload.license?.trim() ?? existing?.license;
    if (license) manifest.license = license;
    const icon = payload.icon?.trim() ?? existing?.icon;
    if (icon) manifest.icon = icon;

    const activationEvents = payload.activationEvents ?? existing?.activationEvents;
    if (activationEvents?.length) manifest.activationEvents = activationEvents;
    if (capabilities) manifest.capabilities = capabilities;
    if (contributes) manifest.contributes = contributes;
    const dependencies =
      payload.extensionDependencies ?? existing?.extensionDependencies;
    if (dependencies?.length) manifest.extensionDependencies = dependencies;

    return manifest;
  }

  private writeMarketManifest(
    dir: string,
    payload: MarketImportPayload
  ): { ok: boolean; error?: string } {
    const name = payload.name?.trim();
    const id = payload.id?.trim();
    if (!name || !id) {
      return { ok: false, error: "发布记录里的清单缺少 id 或 name" };
    }
    const manifest: PluginManifest = {
      id,
      name,
      version: payload.version?.trim() || "0.0.1",
      publisher: payload.publisher?.trim() || "market",
      engines: {
        qnote:
          payload.engines?.qnote?.trim() ||
          `^${this.hostVersion.split(".").slice(0, 2).join(".")}.0`,
      },
      runtime: {
        command: payload.runtime?.command ?? payload.command,
        args: payload.runtime?.args ?? payload.args,
        cwd: payload.runtime?.cwd ?? payload.cwd,
        env: payload.runtime?.env ?? payload.env,
        preview: payload.runtime?.preview ?? payload.preview,
      },
    };
    const description = payload.description?.trim();
    if (description) manifest.description = description;
    if (payload.capabilities) manifest.capabilities = payload.capabilities;
    if (payload.contributes) manifest.contributes = payload.contributes;
    const dependencies = payload.extensionDependencies
      ?.map((item) => item.trim())
      .filter(Boolean);
    if (dependencies?.length) manifest.extensionDependencies = dependencies;

    return writePluginManifestToDir(dir, manifest);
  }
}

function toPluginRecord(row: any): PluginRecord {
  return {
    localId: Number(row.local_id),
    id: row.id,
    name: row.name,
    version: row.version,
    publisher: row.publisher,
    description: row.description ?? undefined,
    path: row.path,
    status: row.status as PluginStatus,
    manifestText: row.manifest_text ?? undefined,
    command: row.command ?? undefined,
    preview: row.preview ?? undefined,
    error: row.error ?? undefined,
    origin: (row.origin as PluginOrigin) ?? "local",
    enabled: Number(row.enabled) !== 0,
    confirmedManifestHash: row.confirmed_manifest_hash || undefined,
    runtime: parseJson<PluginRuntimeConfig>(row.runtime_json),
    capabilities: parseJson<PluginCapabilities>(row.capabilities_json),
    contributes: parseJson<PluginContributes>(row.contributes_json),
  };
}

function parseJson<T>(text: unknown): T | undefined {
  if (typeof text !== "string" || !text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
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
