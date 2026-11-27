import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { app } from "electron";
import { log } from "../../../system/log";
import { getDevRoot } from "../../../../utils/paths";
import { OpencodeClient } from "./client";
import type { OpencodeCredentials } from "./protocol";

const LISTENING_PATTERN = /opencode server listening on (https?:\/\/[^\s"']+)/;
const BINARY_NAMES = ["opencode.exe", "opencode"];

export interface OpencodeServerOptions {
  binary?: string;
  workingDir?: string;
  username?: string;
  password?: string;
  startupTimeoutMs?: number;
  healthIntervalMs?: number;
}

export class OpencodeServer {
  private child: ChildProcess | null = null;
  private client: OpencodeClient | null = null;
  private starting: Promise<OpencodeClient> | null = null;

  constructor(private readonly options: OpencodeServerOptions = {}) {}

  get running(): boolean {
    return this.client !== null;
  }

  get currentClient(): OpencodeClient | null {
    return this.client;
  }

  async start(): Promise<OpencodeClient> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;
    this.starting = this.boot().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.client = null;
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    log.info("[opencode] server 已停止");
  }

  private async boot(): Promise<OpencodeClient> {
    const binary = resolveOpencodeBinary(this.options.binary);
    if (!binary) {
      throw new Error(
        "找不到 opencode 可执行文件，请安装 opencode 或设置 QNOTE_OPENCODE_BIN"
      );
    }

    const workingDir = this.options.workingDir ?? defaultWorkingDir();
    fs.mkdirSync(workingDir, { recursive: true });

    const credentials: OpencodeCredentials = {
      username: this.options.username || "qnote",
      password: this.options.password || randomBytes(24).toString("hex"),
    };

    const port = await findFreePort();
    const child = spawn(
      binary,
      ["serve", "--port", String(port), "--hostname", "127.0.0.1"],
      {
        cwd: workingDir,
        env: {
          ...process.env,
          OPENCODE_SERVER_USERNAME: credentials.username,
          OPENCODE_SERVER_PASSWORD: credentials.password,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    this.child = child;

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) log.warn(`[opencode] ${text}`);
    });

    child.on("exit", (code) => {
      log.info(`[opencode] server 退出，代码 ${code}`);
      if (this.child === child) {
        this.child = null;
        this.client = null;
      }
    });

    const timeoutMs = this.options.startupTimeoutMs ?? 30000;
    const url = await this.waitForUrl(child, timeoutMs);
    const client = new OpencodeClient({ baseUrl: url, credentials });
    await this.waitForHealth(client, timeoutMs);

    this.client = client;
    log.info("[opencode] server 已就绪", { url, workingDir, pid: child.pid });
    return client;
  }

  private waitForUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buffer = "";
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.off("exit", onExit);
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const match = buffer.match(LISTENING_PATTERN);
        if (!match) return;
        cleanup();
        resolve(match[1]);
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`opencode server 启动即退出，代码 ${code}`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("opencode server 启动超时"));
      }, timeoutMs);

      child.stdout?.on("data", onData);
      child.on("exit", onExit);
    });
  }

  private async waitForHealth(
    client: OpencodeClient,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const interval = this.options.healthIntervalMs ?? 500;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
      try {
        const health = await client.health();
        if (health?.healthy) return;
      } catch (err) {
        lastError = err;
      }
      await delay(interval);
    }

    throw new Error(
      `opencode server 健康检查超时${lastError ? `：${String(lastError)}` : ""}`
    );
  }
}

export async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => {
        if (port) resolve(port);
        else reject(new Error("拿不到空闲端口"));
      });
    });
  });
}

export function resolveOpencodeBinary(explicit?: string): string | null {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (process.env.QNOTE_OPENCODE_BIN) candidates.push(process.env.QNOTE_OPENCODE_BIN);

  const names = BINARY_NAMES;
  const packagedDir = process.resourcesPath
    ? path.join(process.resourcesPath, "resources", "opencode")
    : "";
  const devRoot = getDevRoot();

  const dirs = [
    packagedDir,
    path.join(devRoot, "resources", "opencode"),
    path.join(devRoot, "node_modules", "opencode-ai", "bin"),
    path.join(path.dirname(process.execPath), "node_modules", "opencode-ai", "bin"),
  ];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      candidates.push(path.join(dir, name));
    }
  }

  for (const name of names) {
    const onPath = findOnPath(name);
    if (onPath) candidates.push(onPath);
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findOnPath(name: string): string | null {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function defaultWorkingDir(): string {
  try {
    return path.join(app.getPath("userData"), "opencode", "workspace");
  } catch {
    return path.join(process.cwd(), ".data", "opencode", "workspace");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
