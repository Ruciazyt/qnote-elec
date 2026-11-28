import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../../../system/log";
import {
  clearRunnerLock,
  isProcessAlive,
  isRunnerProcess,
  killProcess,
  readRunnerLock,
  terminateProcess,
  writeRunnerLock,
} from "./lock";
import {
  runnerBuildsDir,
  runnerConfigPath,
  resolveRunnerBinary,
} from "./paths";
import { runnerShell } from "./shell";

const RESTART_DELAYS_MS = [3000, 10000, 30000, 60000];
const MAX_RESTARTS = 5;
const MAX_LOG_CHUNK = 2000;
const NOISE_PATTERNS = [
  "Checking for jobs",
  "Appending trace",
  "Submitting job",
  "Updating job",
  "Removed job from processing list",
  "Verifying runner",
  "Created missing unique system ID",
];
const EARLY_EXIT_MS = 25000;
const STABLE_RUN_MS = 10 * 60 * 1000;
const STALE_WAIT_STEPS = 20;
const STALE_WAIT_MS = 150;

export interface RunnerExitInfo {
  code: number | null;
  signal: string | null;
  early: boolean;
}

export interface GitlabRunnerStatus {
  running: boolean;
  pid: number;
  binaryPath: string;
  configPath: string;
  restarts: number;
  lastError: string;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class GitlabRunnerProcess {
  private child: ChildProcess | null = null;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private restarts = 0;
  private lastError = "";
  private startedAt = 0;

  onUnexpectedExit: ((info: RunnerExitInfo) => void) | null = null;

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }

  get pid(): number {
    return this.child?.pid ?? 0;
  }

  status(): GitlabRunnerStatus {
    return {
      running: this.running,
      pid: this.pid,
      binaryPath: resolveRunnerBinary() ?? "",
      configPath: runnerConfigPath(),
      restarts: this.restarts,
      lastError: this.lastError,
    };
  }

  start(): { ok: boolean; error?: string } {
    if (this.running) return { ok: true };
    this.stopping = false;
    try {
      return this.spawnRunner();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      log.error("[gitlab-bot] runner 启动失败", err);
      return { ok: false, error: this.lastError };
    }
  }

  private spawnRunner(): { ok: boolean; error?: string } {
    const binary = resolveRunnerBinary();
    if (!binary) {
      this.lastError = "找不到 gitlab-runner 可执行文件";
      log.warn("[gitlab-bot] " + this.lastError);
      return { ok: false, error: this.lastError };
    }

    const configPath = runnerConfigPath();
    if (!fs.existsSync(configPath)) {
      this.lastError = "runner 尚未注册，缺少 config.toml";
      log.warn("[gitlab-bot] " + this.lastError);
      return { ok: false, error: this.lastError };
    }

    this.killStaleRunner();
    this.ensureShell(configPath);

    const builds = runnerBuildsDir();
    fs.mkdirSync(builds, { recursive: true });

    const child = spawn(
      binary,
      ["run", "--config", configPath, "--working-directory", builds],
      {
        cwd: path.dirname(configPath),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    this.child = child;
    this.startedAt = Date.now();

    child.stdout?.on("data", (chunk: Buffer) => {
      this.logChunk(chunk.toString("utf8"), false);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.logChunk(chunk.toString("utf8"), true);
    });

    child.on("error", (err) => {
      log.error("[gitlab-bot] runner 进程错误", err);
      this.handleChildGone(child, null, null, err.message);
    });

    child.on("exit", (code, signal) => {
      this.handleChildGone(child, code, signal);
    });

    if (child.pid) {
      writeRunnerLock({
        pid: child.pid,
        startedAt: Date.now(),
        binary,
      });
    }

    this.lastError = "";
    log.info("[gitlab-bot] runner 已启动", {
      pid: child.pid,
      binary,
      configPath,
    });
    return { ok: true };
  }

  private handleChildGone(
    child: ChildProcess,
    code: number | null,
    signal: string | null,
    errorText?: string
  ): void {
    if (this.child === child) {
      this.child = null;
      clearRunnerLock();
    }
    if (this.stopping) return;
    const lived = Date.now() - this.startedAt;
    const early = lived < EARLY_EXIT_MS;
    if (lived >= STABLE_RUN_MS) this.restarts = 0;
    this.lastError =
      errorText ??
      "runner 进程退出，代码 " + String(code) + " 信号 " + String(signal);
    log.warn("[gitlab-bot] " + this.lastError);
    this.scheduleRestart();
    this.onUnexpectedExit?.({ code, signal, early });
  }

  cancelRestart(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.child = null;
    clearRunnerLock();
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
    log.info("[gitlab-bot] runner 已停止");
  }

  private ensureShell(configPath: string): void {
    const expected = runnerShell();
    try {
      const text = fs.readFileSync(configPath, "utf8");
      let changed = false;
      const lines = text.split("\n").map((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("shell")) return line;
        const match = trimmed.match(/^shell[ \t]*=[ \t]*"([^"]*)"/);
        if (!match || match[1] === expected) return line;
        changed = true;
        const indent = line.slice(0, line.length - line.trimStart().length);
        return indent + 'shell = "' + expected + '"';
      });
      if (!changed) return;
      fs.writeFileSync(configPath, lines.join("\n"), "utf8");
      log.info("[gitlab-bot] runner shell 已切到 " + expected);
    } catch (err) {
      log.warn("[gitlab-bot] 同步 runner shell 失败", err);
    }
  }

  private killStaleRunner(): void {
    const lock = readRunnerLock();
    if (!lock) return;
    if (!isProcessAlive(lock.pid)) {
      clearRunnerLock();
      return;
    }
    if (!isRunnerProcess(lock.pid)) {
      clearRunnerLock();
      return;
    }
    log.warn(
      "[gitlab-bot] 发现上一个实例留下的 runner 进程 " +
        lock.pid +
        "，先结束掉"
    );
    terminateProcess(lock.pid);
    for (let step = 0; step < STALE_WAIT_STEPS; step += 1) {
      if (!isProcessAlive(lock.pid)) break;
      sleepSync(STALE_WAIT_MS);
    }
    if (isProcessAlive(lock.pid)) {
      killProcess(lock.pid);
    }
    clearRunnerLock();
  }

  private scheduleRestart(): void {
    if (this.restarts >= MAX_RESTARTS) {
      log.error("[gitlab-bot] runner 反复启动失败，已放弃自动重启");
      return;
    }
    const delay =
      RESTART_DELAYS_MS[Math.min(this.restarts, RESTART_DELAYS_MS.length - 1)];
    this.restarts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delay);
  }

  private logChunk(text: string, fromStderr: boolean): void {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
      if (!line) continue;
      if (NOISE_PATTERNS.some((pattern) => line.includes(pattern))) continue;
      const clipped =
        line.length > MAX_LOG_CHUNK ? line.slice(0, MAX_LOG_CHUNK) : line;
      if (fromStderr && /error|fatal|panic/i.test(clipped)) {
        log.warn("[gitlab-runner] " + clipped);
        continue;
      }
      log.info("[gitlab-runner] " + clipped);
    }
  }
}
