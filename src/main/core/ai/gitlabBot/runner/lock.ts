import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "../../../system/log";
import { runnerDir } from "./paths";

export interface RunnerLock {
  pid: number;
  startedAt: number;
  binary: string;
}

export function runnerLockPath(): string {
  return path.join(runnerDir(), "runner.lock");
}

export function readRunnerLock(): RunnerLock | null {
  try {
    const raw = fs.readFileSync(runnerLockPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid === "number" && parsed.pid > 0) {
      return {
        pid: parsed.pid,
        startedAt: Number(parsed.startedAt) || 0,
        binary: typeof parsed.binary === "string" ? parsed.binary : "",
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function writeRunnerLock(lock: RunnerLock): void {
  try {
    fs.mkdirSync(runnerDir(), { recursive: true });
    fs.writeFileSync(
      runnerLockPath(),
      JSON.stringify(lock),
      "utf8"
    );
  } catch (err) {
    log.warn("[gitlab-bot] 写 runner 锁文件失败", err);
  }
}

export function clearRunnerLock(): void {
  try {
    fs.rmSync(runnerLockPath(), { force: true });
  } catch {
    // ignore
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function findSystemTool(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function tasklistPath(): string | null {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return findSystemTool([
    path.join(systemRoot, "System32", "tasklist.exe"),
    path.join(systemRoot, "SysWOW64", "tasklist.exe"),
  ]);
}

function psPath(): string | null {
  return findSystemTool(["/bin/ps", "/usr/bin/ps", "/usr/local/bin/ps"]);
}

export function isRunnerProcess(pid: number): boolean {
  if (!isProcessAlive(pid)) return false;
  try {
    if (process.platform === "win32") {
      const tool = tasklistPath();
      if (!tool) return false;
      const output = execFileSync(
        tool,
        ["/FI", "PID eq " + pid, "/NH", "/FO", "CSV"],
        { encoding: "utf8", windowsHide: true }
      );
      return /gitlab-runner/i.test(output);
    }
    const tool = psPath();
    if (!tool) return false;
    const output = execFileSync(tool, ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
    });
    return /gitlab-runner/i.test(output);
  } catch {
    return false;
  }
}

export function terminateProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function killProcess(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
}
