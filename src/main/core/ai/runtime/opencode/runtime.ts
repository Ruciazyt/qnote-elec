import * as path from "node:path";
import { log } from "../../../system/log";
import { QnoteMcpServer } from "../mcp/server";
import { OpencodeDriver, type OpencodeDriverHandlers, type OpencodeDriverResult } from "./driver";
import { QNOTE_AGENT_NAME, QNOTE_CODE_AGENT_NAME } from "./profile";
import { OpencodeServer, defaultWorkingDir } from "./server";
import type { OpencodeClient } from "./client";
import type { OpencodePartInput } from "./protocol";
import {
  buildOpencodeWorkspace,
  writeOpencodeWorkspace,
  writeWorkspaceToDirectory,
  type OpencodeProviderEntry,
  type OpencodeWorkspaceFiles,
} from "./workspace";

export const QNOTE_SESSION_METADATA_KEY = "qnoteChatSessionId";

export interface OpencodeTurnInput {
  chatSessionId: string;
  parts: OpencodePartInput[];
  provider: OpencodeProviderEntry;
  signal?: AbortSignal;
  handlers?: OpencodeDriverHandlers;
  directory?: string;
  agentName?: string;
}

export interface OpencodeRuntimeOptions {
  workingDir?: string;
  username?: string;
  password?: string;
}

interface RetiringRuntime {
  client: OpencodeClient | null;
  server: OpencodeServer | null;
  mcp: QnoteMcpServer | null;
}

export class OpencodeRuntime {
  private server: OpencodeServer | null = null;
  private mcp: QnoteMcpServer | null = null;
  private client: OpencodeClient | null = null;
  private starting: Promise<OpencodeClient> | null = null;
  private fingerprint = "";
  private files: OpencodeWorkspaceFiles | null = null;
  private activeTurns = new Map<OpencodeClient, number>();
  private retiring: RetiringRuntime[] = [];

  constructor(private readonly options: OpencodeRuntimeOptions = {}) {}

  get workingDir(): string {
    return this.options.workingDir ?? defaultWorkingDir();
  }

  async ensureStarted(provider: OpencodeProviderEntry): Promise<OpencodeClient> {
    const next = fingerprint(provider);
    if (this.client && this.fingerprint === next) return this.client;

    if (this.starting) {
      const started = await this.starting;
      if (this.client === started && this.fingerprint === next) return started;
    }

    if (this.client) {
      log.info("[opencode] provider 配置变化，重启 runtime");
    }
    await this.retireCurrent();

    this.starting = this.boot(provider).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async retireCurrent(): Promise<void> {
    if (!this.server && !this.mcp && !this.client) return;
    const entry: RetiringRuntime = {
      client: this.client,
      server: this.server,
      mcp: this.mcp,
    };
    this.server = null;
    this.mcp = null;
    this.client = null;
    this.fingerprint = "";

    if ((this.activeTurns.get(entry.client as OpencodeClient) ?? 0) > 0) {
      this.retiring.push(entry);
      return;
    }
    await this.stopEntry(entry);
  }

  private async stopEntry(entry: RetiringRuntime): Promise<void> {
    await entry.server?.stop();
    await entry.mcp?.stop();
  }

  private releaseTurn(client: OpencodeClient): void {
    const left = (this.activeTurns.get(client) ?? 1) - 1;
    if (left > 0) {
      this.activeTurns.set(client, left);
      return;
    }
    this.activeTurns.delete(client);
    const index = this.retiring.findIndex((entry) => entry.client === client);
    if (index < 0) return;
    const [entry] = this.retiring.splice(index, 1);
    void this.stopEntry(entry);
  }

  async stop(): Promise<void> {
    const pending = this.retiring.splice(0);
    for (const entry of pending) {
      await this.stopEntry(entry);
    }
    await this.server?.stop();
    await this.mcp?.stop();
    this.server = null;
    this.mcp = null;
    this.client = null;
    this.fingerprint = "";
    this.activeTurns.clear();
  }

  async resolveOpencodeSessionId(
    chatSessionId: string,
    provider: OpencodeProviderEntry,
    options: { directory?: string; agentName?: string } = {}
  ): Promise<string> {
    const client = this.client;
    if (!client) throw new Error("opencode runtime 未启动");
    const existing = await this.findSession(
      client,
      chatSessionId,
      options.directory
    );
    if (existing) return existing;
    const session = await client.createSession({
      title: "QNote 对话",
      agent: options.agentName ?? QNOTE_AGENT_NAME,
      model: { providerID: provider.id, modelID: provider.model },
      metadata: { [QNOTE_SESSION_METADATA_KEY]: chatSessionId },
      directory: options.directory,
    });
    log.info("[opencode] 新建会话", {
      sessionID: session.id,
      chatSessionId,
      model: provider.model,
    });
    return session.id;
  }

  async runTurn(input: OpencodeTurnInput): Promise<OpencodeDriverResult> {
    const client = await this.ensureStarted(input.provider);
    this.activeTurns.set(client, (this.activeTurns.get(client) ?? 0) + 1);
    try {
      this.syncWorkspace(input.directory);
      const sessionId = await this.resolveOpencodeSessionId(
        input.chatSessionId,
        input.provider,
        { directory: input.directory, agentName: input.agentName }
      );
      return await this.sendTurn(client, sessionId, input);
    } finally {
      this.releaseTurn(client);
    }
  }

  private async sendTurn(
    client: OpencodeClient,
    sessionId: string,
    input: OpencodeTurnInput
  ): Promise<OpencodeDriverResult> {
    const driver = new OpencodeDriver({
      client,
      sessionID: sessionId,
      agent: input.agentName ?? QNOTE_AGENT_NAME,
      signal: input.signal,
      handlers: input.handlers,
      directory: input.directory,
    });
    return driver.run(input.parts, {
      model: { providerID: input.provider.id, modelID: input.provider.model },
    });
  }

  private async findSession(
    client: OpencodeClient,
    chatSessionId: string,
    directory?: string
  ): Promise<string | null> {
    const target = directory
      ? path.resolve(directory)
      : path.resolve(this.workingDir);
    try {
      const sessions = await client.listSessions();
      const matched = sessions.find((session) => {
        if ((session.metadata || {})[QNOTE_SESSION_METADATA_KEY] !== chatSessionId) {
          return false;
        }
        if (!session.directory) return !directory;
        return samePath(session.directory, target);
      });
      return matched?.id ?? null;
    } catch (err) {
      log.warn("[opencode] 读取会话列表失败，按新会话处理:", err);
      return null;
    }
  }

  private syncWorkspace(directory?: string): void {
    const files = this.files;
    if (!files || !directory) return;
    const target = path.resolve(directory);
    if (target === path.resolve(this.workingDir)) return;
    try {
      writeWorkspaceToDirectory(target, files);
      log.info("[opencode] 工作区配置已同步到会话目录", { target });
    } catch (err) {
      log.warn("[opencode] 同步工作区配置到 " + target + " 失败", err);
    }
  }

  private async boot(provider: OpencodeProviderEntry): Promise<OpencodeClient> {
    let mcp: QnoteMcpServer | null = null;
    let server: OpencodeServer | null = null;
    try {
      mcp = new QnoteMcpServer({});
      const endpoint = await mcp.start();
      this.mcp = mcp;

      const files = buildOpencodeWorkspace({
        directory: this.workingDir,
        mcpUrl: endpoint.url,
        mcpToken: endpoint.token,
        provider,
      });
      this.files = files;
      writeOpencodeWorkspace(this.workingDir, files.configJson, {
        [QNOTE_AGENT_NAME]: files.agentMarkdown,
        [QNOTE_CODE_AGENT_NAME]: files.codeAgentMarkdown,
      });

      server = new OpencodeServer({
        workingDir: this.workingDir,
        username: this.options.username ?? "qnote",
        password: this.options.password,
      });
      const client = await server.start();
      this.server = server;
      this.client = client;
      this.fingerprint = fingerprint(provider);
      log.info("[opencode] runtime 就绪", {
        workingDir: this.workingDir,
        tools: endpoint.toolNames.length,
        model: provider.model,
      });
      return client;
    } catch (err) {
      await server?.stop().catch(() => undefined);
      await mcp?.stop().catch(() => undefined);
      this.server = null;
      this.mcp = null;
      this.client = null;
      this.fingerprint = "";
      log.error("[opencode] runtime 启动失败，已清理残留资源", err);
      throw err;
    }
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value).replace(/\\/g, "/").replace(/\/$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function fingerprint(provider: OpencodeProviderEntry): string {
  return JSON.stringify({
    id: provider.id,
    npm: provider.npm,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL ?? "",
    model: provider.model,
  });
}

let runtime: OpencodeRuntime | null = null;

export function getOpencodeRuntime(): OpencodeRuntime {
  if (!runtime) runtime = new OpencodeRuntime();
  return runtime;
}

export async function stopOpencodeRuntime(): Promise<void> {
  if (!runtime) return;
  await runtime.stop();
  runtime = null;
}
