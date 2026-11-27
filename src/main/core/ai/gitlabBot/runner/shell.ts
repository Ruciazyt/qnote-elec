export type RunnerShell = "powershell" | "bash";

/**
 * runner 用哪个 shell。
 *
 * Windows 上不能用 Git Bash —— MSYS 会把 runner 传的 Windows 路径转成 POSIX 路径，
 * 而 runner 自己又要拼一次原始路径，最后得到
 * `/d/.../builds/D:/.../builds/...` 这种废路径，变量文件直接生成失败（实测）。
 * macOS / Linux 上 bash 是唯一选择。
 */
export function detectRunnerShell(): RunnerShell {
  return process.platform === "win32" ? "powershell" : "bash";
}

export const runnerShell = detectRunnerShell;
