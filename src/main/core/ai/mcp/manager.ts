import { randomUUID } from "node:crypto";
import { appVersion } from "../../system/appVersion";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { log } from "../../system/log";
import { loadMcpSdk } from "./sdk";
import {
  initMcpStore,
  loadMcpProjectDir,
  loadMcpServerConfigs,
  saveMcpProjectDir,
  saveMcpServerConfigs,
} from "./store";
import { buildMcpTool } from "./tools";
import { McpNameRegistry } from "./nameRegistry";
import { loadProjectMcpConfig, type ProjectMcpEntry } from "./projectConfig";
import {
  createProcessEnvLookup,
  expandArgs,
  expandRecord,
  expandTemplate,
} from "./env";
import { describeMcpCallErrorText } from "./callError";
import { formatToolResult } from "./result";
import type {
  McpClientLike,
  McpProjectState,
  McpServerConfig,
  McpServerInput,
  McpServerState,
  McpServerStatus,
  McpToolInfo,
} from "./types";

const CONNECT_TIMEOUT_DEFAULT = 15_000;
const CALL_TIMEOUT_DEFAULT = 60_000;

interface ResolveConfigResult {
  ok: boolean;
  config: McpServerConfig;
  error: string;
}

interface LiveServer {
  client: McpClientLike;
  transport: { close(): Promise<void> };
  tools: McpToolInfo[];
  controller: AbortController;
}

export function validateMcpServer(input: McpServerInput): {
  valid: boolean;
  error?: string;
} {
  const name = (input.name || "").trim();
  if (!name) return { valid: false, error: "服务器名称不能为空" };
  if (name.length > 40) return { valid: false, error: "服务器名称过长（最多 40 字）" };
  if (!["stdio", "http", "sse"].includes(input.transport)) {
    return { valid: false, error: "不支持的连接方式" };
  }
  if (input.transport === "stdio") {
    if (!String(input.command || "").trim()) {
      return { valid: false, error: "stdio 方式必须填写启动命令" };
    }
    return { valid: true };
  }
  const url = String(input.url || "").trim();
  if (!url) return { valid: false, error: "必须填写服务器地址" };
  if (!/^https?:\/\//i.test(url)) {
    return { valid: false, error: "地址必须以 http:// 或 https:// 开头" };
  }
  return { valid: true };
}

class McpManager {
  private userConfigs = new Map<string, McpServerConfig>();
  private projectEntries = new Map<string, ProjectMcpEntry>();
  private live = new Map<string, LiveServer>();
  private statuses = new Map<string, { status: McpServerStatus; error?: string }>();
  private toolCache: StructuredToolInterface[] = [];
  private registry = new McpNameRegistry();
  private projectDir: string | null = null;
  private projectFingerprint: string | null = null;
  private projectFilePath: string | null = null;
  private projectError: string | undefined;

  async init(DB: any): Promise<void> {
    initMcpStore(DB);
    const list = await loadMcpServerConfigs();
    this.userConfigs.clear();
    for (const cfg of list) {
      this.userConfigs.set(cfg.id, {
        ...cfg,
        enabled: cfg.enabled !== false,
        source: "user",
      });
    }
    this.projectDir = await loadMcpProjectDir();
    this.reloadProjectConfig();
    log.info(
      `[mcp] 已载入 ${this.userConfigs.size} 个用户服务器，${this.projectEntries.size} 个项目服务器`
    );
  }

  getProjectState(): McpProjectState {
    return {
      dir: this.projectDir,
      filePath: this.projectFilePath,
      error: this.projectError,
    };
  }

  async setProjectDir(dir: string | null): Promise<McpProjectState> {
    const next = dir && dir.trim() ? dir.trim() : null;
    this.projectDir = next;
    await saveMcpProjectDir(next);
    this.reloadProjectConfig();
    await this.closeProjectConnections();
    this.rebuildTools();
    return this.getProjectState();
  }

  async reload(): Promise<McpServerState[]> {
    const changed = this.reloadProjectConfig();
    if (changed) {
      await this.closeProjectConnections();
    }
    this.rebuildTools();
    return this.listServers();
  }

  listServers(): McpServerState[] {
    return [...this.effectiveConfigs().values()].map((cfg) => this.toState(cfg));
  }

  getServer(id: string): McpServerState | null {
    const cfg = this.effectiveConfigs().get(id);
    return cfg ? this.toState(cfg) : null;
  }

  listTools(id: string): McpToolInfo[] {
    return this.live.get(id)?.tools ?? [];
  }

  getTools(): StructuredToolInterface[] {
    return [...this.toolCache];
  }

  async ensureToolsReady(): Promise<void> {
    if (this.reloadProjectConfig()) {
      await this.closeProjectConnections();
    }
    const pending = [...this.effectiveConfigs().values()].filter(
      (cfg) =>
        cfg.enabled !== false &&
        !this.live.has(cfg.id) &&
        !this.statuses.has(cfg.id)
    );
    if (pending.length === 0) {
      this.rebuildTools();
      return;
    }
    await Promise.all(
      pending.map((cfg) =>
        this.connect(cfg.id).catch((err) => {
          log.error(`[mcp] 服务器 ${cfg.name} 连接失败`, err);
        })
      )
    );
    this.rebuildTools();
  }

  async saveServer(input: McpServerInput): Promise<McpServerState> {
    const validation = validateMcpServer(input);
    if (!validation.valid) {
      throw new Error(validation.error || "配置无效");
    }

    const name = input.name.trim();
    if (this.projectEntries.has(name)) {
      throw new Error(`同名服务器「${name}」已由项目配置提供`);
    }
    const duplicate = [...this.userConfigs.values()].find(
      (cfg) => cfg.name === name && cfg.id !== input.id
    );
    if (duplicate) {
      throw new Error(`已存在同名服务器「${name}」`);
    }

    const id = input.id || randomUUID();
    const config: McpServerConfig = {
      id,
      name,
      transport: input.transport,
      enabled: input.enabled !== false,
      command: input.command?.trim() || undefined,
      args: input.args?.length ? input.args : undefined,
      env: input.env && Object.keys(input.env).length ? input.env : undefined,
      cwd: input.cwd?.trim() || undefined,
      url: input.url?.trim() || undefined,
      headers:
        input.headers && Object.keys(input.headers).length ? input.headers : undefined,
      timeout: normalizeTimeout(input.timeout),
      source: "user",
    };

    this.userConfigs.set(id, config);
    await this.persist();

    if (!config.enabled) {
      await this.disconnect(id);
      return this.toState(config);
    }

    await this.connect(id);
    return this.toState(config);
  }

  async setServerEnabled(id: string, enabled: boolean): Promise<McpServerState> {
    const config = this.userConfigs.get(id);
    if (!config) {
      throw new Error("项目级服务器不可修改，请编辑项目 .mcp.json");
    }
    const next: McpServerConfig = { ...config, enabled };
    this.userConfigs.set(id, next);
    await this.persist();
    if (!enabled) {
      await this.disconnect(id);
      return this.toState(next);
    }
    await this.connect(id);
    return this.toState(next);
  }

  async deleteServer(id: string): Promise<boolean> {
    const existing = this.effectiveConfigs().get(id);
    if (existing && (existing.source ?? "user") === "project") {
      throw new Error("项目级服务器不可删除，请修改项目 .mcp.json");
    }
    if (!this.userConfigs.has(id)) return false;
    await this.disconnect(id);
    this.userConfigs.delete(id);
    await this.persist();
    this.rebuildTools();
    return true;
  }

  async connect(id: string): Promise<McpServerState> {
    const config = this.effectiveConfigs().get(id);
    if (!config) throw new Error("MCP 服务器不存在");

    await this.closeLive(id);
    if (config.enabled === false) {
      this.statuses.set(id, { status: "disabled" });
      this.rebuildTools();
      return this.toState(config);
    }

    this.statuses.set(id, { status: "connecting" });

    try {
      const resolved = this.resolveConfig(config);
      if (!resolved.ok) {
        throw new Error(resolved.error);
      }
      const sdk = loadMcpSdk();
      const client = new sdk.client.Client(
        { name: "qnote", version: appVersion() },
        { capabilities: {} }
      );
      const transport = this.buildTransport(sdk, resolved.config);
      this.observeStderr(transport, config.name);
      const timeout = resolved.config.timeout ?? CONNECT_TIMEOUT_DEFAULT;
      await client.connect(transport, { timeout });
      const listed = await client.listTools(undefined, { timeout });
      const tools: McpToolInfo[] = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
      this.live.set(id, {
        client,
        transport,
        tools,
        controller: new AbortController(),
      });
      this.statuses.set(id, { status: "connected" });
      log.info(`[mcp] 服务器 ${config.name} 已连接，提供 ${tools.length} 个工具`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.statuses.set(id, { status: "error", error: message });
      log.error(`[mcp] 服务器 ${config.name} 连接失败:`, message);
    }

    this.rebuildTools();
    return this.toState(config);
  }

  async disconnect(id: string): Promise<McpServerState | null> {
    const config = this.effectiveConfigs().get(id);
    await this.closeLive(id);
    this.statuses.set(id, { status: "disconnected" });
    this.rebuildTools();
    return config ? this.toState(config) : null;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const first = await this.invokeTool(serverId, toolName, args);
    if (first.ok) return first.text;
    if (!first.retryable) return first.text;

    await this.closeLive(serverId);
    const second = await this.invokeTool(serverId, toolName, args);
    return second.text;
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.live.keys()]) {
      await this.closeLive(id);
    }
    this.toolCache = [];
  }

  private async invokeTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; text: string; retryable: boolean }> {
    let live: LiveServer;
    try {
      live = await this.ensureLive(serverId);
    } catch (err) {
      return {
        ok: false,
        text: `调用失败：${describeMcpCallErrorText(err)}`,
        retryable: false,
      };
    }

    const timeout = this.effectiveConfigs().get(serverId)?.timeout ?? CALL_TIMEOUT_DEFAULT;
    try {
      const result = await live.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout, signal: live.controller.signal }
      );
      return { ok: true, text: formatToolResult(result), retryable: false };
    } catch (err) {
      const text = `调用失败：${describeMcpCallErrorText(err)}`;
      return { ok: false, text, retryable: isRetryableError(err) };
    }
  }

  private async ensureLive(serverId: string): Promise<LiveServer> {
    const existing = this.live.get(serverId);
    if (existing) return existing;
    const config = this.effectiveConfigs().get(serverId);
    if (!config) throw new Error("MCP 服务器不存在");
    if (config.enabled === false) throw new Error("MCP 服务器已停用");
    await this.connect(serverId);
    const live = this.live.get(serverId);
    if (!live) {
      const status = this.statuses.get(serverId);
      throw new Error(status?.error || "MCP 服务器连接失败");
    }
    return live;
  }

  private resolveConfig(config: McpServerConfig): ResolveConfigResult {
    const lookup = createProcessEnvLookup();
    const env = expandRecord(config.env, lookup);
    if (!env.ok) return { ok: false, config, error: "缺少环境变量 " + env.missing };
    const headers = expandRecord(config.headers, lookup);
    if (!headers.ok) {
      return { ok: false, config, error: "缺少环境变量 " + headers.missing };
    }
    const args = expandArgs(config.args, lookup);
    if (!args.ok) return { ok: false, config, error: "缺少环境变量 " + args.missing };
    const command = config.command ? expandTemplate(config.command, lookup) : null;
    if (command && !command.ok) {
      return { ok: false, config, error: "缺少环境变量 " + command.missing };
    }
    const url = config.url ? expandTemplate(config.url, lookup) : null;
    if (url && !url.ok) {
      return { ok: false, config, error: "缺少环境变量 " + url.missing };
    }

    return {
      ok: true,
      error: "",
      config: {
        ...config,
        command: command ? command.value : config.command,
        args: args.value.length ? args.value : undefined,
        env: Object.keys(env.value).length ? env.value : undefined,
        headers: Object.keys(headers.value).length ? headers.value : undefined,
        url: url ? url.value : config.url,
      },
    };
  }

  private buildTransport(
    sdk: any,
    config: McpServerConfig
  ): { close(): Promise<void> } {
    if (config.transport === "stdio") {
      return new sdk.stdio.StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...sdk.stdio.getDefaultEnvironment(), ...(config.env ?? {}) },
        cwd: config.cwd || undefined,
        stderr: "pipe",
      });
    }
    const url = new URL(String(config.url));
    const requestInit = { headers: config.headers ?? {} };
    if (config.transport === "sse") {
      return new sdk.sse.SSEClientTransport(url, { requestInit });
    }
    return new sdk.http.StreamableHTTPClientTransport(url, { requestInit });
  }

  private observeStderr(transport: unknown, serverName: string): void {
    const stream = (transport as { stderr?: NodeJS.ReadableStream | null })?.stderr;
    if (!stream || typeof stream.on !== "function") return;
    stream.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (text) log.info(`[mcp:${serverName}] ${text}`);
    });
    stream.on("error", () => {});
  }

  private effectiveConfigs(): Map<string, McpServerConfig> {
    const merged = new Map<string, McpServerConfig>();
    for (const entry of this.projectEntries.values()) {
      merged.set(entry.config.id, entry.config);
    }
    for (const [id, cfg] of this.userConfigs) {
      if (this.projectEntries.has(cfg.name)) continue;
      merged.set(id, cfg);
    }
    return merged;
  }

  private reloadProjectConfig(): boolean {
    const result = loadProjectMcpConfig(this.projectDir, createProcessEnvLookup());
    const changed = result.fingerprint !== this.projectFingerprint;
    this.projectEntries = new Map(result.entries.map((entry) => [entry.name, entry]));
    this.projectFingerprint = result.fingerprint;
    this.projectFilePath = result.filePath;
    this.projectError = result.errors[0];
    if (result.errors.length > 0) {
      log.error(`[mcp] 项目配置异常: ${result.errors.join("; ")}`);
    }
    return changed;
  }

  private async closeProjectConnections(): Promise<void> {
    for (const id of [...this.live.keys()]) {
      const config = this.effectiveConfigs().get(id);
      if (config?.source === "project") {
        await this.closeLive(id);
        this.statuses.delete(id);
      }
    }
  }

  private async closeLive(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    try {
      live.controller.abort();
    } catch {
    }
    try {
      await live.client.close();
    } catch (err) {
      log.error("[mcp] 关闭连接失败", err);
    }
    try {
      await live.transport.close();
    } catch {
    }
  }

  private async persist(): Promise<void> {
    await saveMcpServerConfigs([...this.userConfigs.values()]);
  }

  private rebuildTools(): void {
    const configs = this.effectiveConfigs();
    const candidates = [...this.live.keys()].map((id) => ({
      key: id,
      name: configs.get(id)?.name ?? id,
    }));
    const serverSegments = this.registry.assignServers(candidates);

    const tools: StructuredToolInterface[] = [];
    for (const [serverId, live] of this.live) {
      const serverName = configs.get(serverId)?.name ?? serverId;
      const serverSegment = serverSegments.get(serverId);
      if (!serverSegment) continue;
      const toolSegments = this.registry.assignTools(
        serverId,
        live.tools.map((info) => info.name)
      );
      for (const info of live.tools) {
        const toolSegment = toolSegments.get(info.name);
        if (!toolSegment) continue;
        tools.push(
          buildMcpTool({
            name: `mcp__${serverSegment}__${toolSegment}`,
            serverName,
            tool: info,
            invoke: (args) => this.callTool(serverId, info.name, args),
          })
        );
      }
    }
    this.toolCache = tools;
  }

  private toState(config: McpServerConfig): McpServerState {
    const status = this.statuses.get(config.id);
    const source = config.source ?? "user";
    const projectError =
      source === "project"
        ? this.projectEntries.get(config.name)?.error
        : undefined;
    return {
      id: config.id,
      name: config.name,
      transport: config.transport,
      enabled: config.enabled !== false,
      status:
        config.enabled === false
          ? "disabled"
          : (status?.status ?? "disconnected"),
      error: status?.error ?? projectError,
      tools: this.live.get(config.id)?.tools ?? [],
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      url: config.url,
      headers: config.headers,
      timeout: config.timeout,
      source,
      readOnly: source === "project",
    };
  }
}

function normalizeTimeout(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return Math.floor(value);
}

function isRetryableError(error: unknown): boolean {
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    chain.push(String(Reflect.get(current, "name") ?? ""));
    chain.push(String(Reflect.get(current, "message") ?? ""));
    current = Reflect.get(current, "cause");
  }
  const text = chain.join(" ").toLowerCase();
  return (
    text.includes("econnrefused") ||
    text.includes("econnreset") ||
    text.includes("epipe") ||
    text.includes("closed") ||
    text.includes("not connected") ||
    text.includes("transport") ||
    text.includes("socket hang up")
  );
}

export const mcpManager = new McpManager();
