import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { getDevRoot } from "../../../../utils/paths";

export function runnerBinaryName(): string {
  return process.platform === "win32" ? "gitlab-runner.exe" : "gitlab-runner";
}

export function runnerDir(): string {
  if (!app.isPackaged) {
    return path.join(getDevRoot(), ".data", "opencode", "runner");
  }
  return path.join(app.getPath("userData"), "runner");
}

export function runnerConfigPath(): string {
  return path.join(runnerDir(), "config.toml");
}

export function runnerBuildsDir(): string {
  return path.join(runnerDir(), "builds");
}

export function resolveRunnerBinary(): string | null {
  const name = runnerBinaryName();
  const candidates: string[] = [];

  const explicit = (process.env.QNOTE_GITLAB_RUNNER_BIN || "").trim();
  if (explicit) candidates.push(explicit);

  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, "resources", "gitlab-runner", name)
    );
  }
  candidates.push(
    path.join(getDevRoot(), "resources", "gitlab-runner", name),
    path.join(runnerDir(), name)
  );
  if (!app.isPackaged) {
    candidates.push(
      path.join(getDevRoot(), ".data", "opencode", "runner", name)
    );
  }

  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, name));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}
