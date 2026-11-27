// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let tmpDir = "";

vi.mock("../runner/paths", () => ({
  runnerDir: () => tmpDir,
}));

import {
  clearRunnerLock,
  isProcessAlive,
  readRunnerLock,
  runnerLockPath,
  writeRunnerLock,
} from "../runner/lock";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-runner-lock-"));
});

afterEach(() => {
  clearRunnerLock();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runner 锁文件", () => {
  it("没有锁文件时返回 null", () => {
    expect(readRunnerLock()).toBeNull();
  });

  it("写入后能读回来", () => {
    writeRunnerLock({ pid: 4321, startedAt: 100, binary: "C:/runner.exe" });
    const lock = readRunnerLock();
    expect(lock?.pid).toBe(4321);
    expect(lock?.binary).toBe("C:/runner.exe");
  });

  it("清除后锁文件不存在", () => {
    writeRunnerLock({ pid: 4321, startedAt: 100, binary: "C:/runner.exe" });
    expect(fs.existsSync(runnerLockPath())).toBe(true);
    clearRunnerLock();
    expect(fs.existsSync(runnerLockPath())).toBe(false);
  });

  it("坏内容不抛异常", () => {
    fs.writeFileSync(runnerLockPath(), "不是 JSON", "utf8");
    expect(readRunnerLock()).toBeNull();
  });

  it("当前进程是活着的", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("不存在的 PID 判定为已退出", () => {
    expect(isProcessAlive(0x7ffffff0)).toBe(false);
  });
});
