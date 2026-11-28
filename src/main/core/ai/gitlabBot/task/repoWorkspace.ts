import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../../../system/log";

export interface RepoWorkspaceOptions {
  baseDir: string;
  projectPath: string;
  repoUrl: string;
  branch?: string;
  defaultBranch?: string;
  token: string;
}

export interface RepoWorkspace {
  dir: string;
  branch: string;
  cloned: boolean;
}

export function projectDirName(projectPath: string): string {
  const name = projectPath
    .replace(/[\\/]/g, "__")
    .replace(/[^A-Za-z0-9._-]/g, "_");
  if (!name || name === "." || name === "..") return "_";
  return name;
}

export function buildWorkBranchName(event: {
  issueIid?: number;
  mrIid?: number;
}): string {
  if (event.mrIid) return `qnote/mr-${event.mrIid}`;
  if (event.issueIid) return `qnote/issue-${event.issueIid}`;
  return `qnote/task-${Date.now()}`;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
  };
}

function runGit(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git 走系统 PATH，参数是常量与已校验的仓库路径
      "git", // NOSONAR
      args,
      { cwd, env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || "").trim() || err.message;
          reject(new Error(`git ${args.join(" ")} 失败：${detail}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

async function tryGit(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  try {
    return await runGit(args, cwd, env);
  } catch {
    return null;
  }
}

export function credentialHelperPath(file: string): string {
  const posix = file.replace(/\\/g, "/");
  return "'" + posix.replace(/'/g, "'\\''") + "'";
}

function writeCredentialFile(
  repoUrl: string,
  token: string
): { file: string; helperPath: string; cleanup: () => void } {
  let protocol = "https:";
  let host = "";
  try {
    const url = new URL(repoUrl);
    protocol = url.protocol;
    host = url.host;
  } catch {
    host = "";
  }
  const file = path.join(os.tmpdir(), `qnote-git-cred-${randomUUID()}`);
  fs.writeFileSync(
    file,
    `${protocol}//oauth2:${encodeURIComponent(token)}@${host}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return {
    file,
    helperPath: credentialHelperPath(file),
    cleanup: () => {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore
      }
    },
  };
}

async function resolveDefaultBranch(
  given: string | undefined,
  dir: string,
  env: NodeJS.ProcessEnv,
  authArgs: string[]
): Promise<string> {
  if (given) return given;
  const head = (
    await tryGit(
      [...authArgs, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      dir,
      env
    )
  )?.trim();
  if (head) return head.replace(/^origin\//, "");
  return "main";
}

async function resolveBaseCommit(
  defaultBranch: string,
  dir: string,
  env: NodeJS.ProcessEnv,
  authArgs: string[]
): Promise<string> {
  for (const ref of [`origin/${defaultBranch}`, "origin/HEAD"]) {
    const sha = (
      await tryGit([...authArgs, "rev-parse", "--verify", ref], dir, env)
    )?.trim();
    if (sha) return sha;
  }
  throw new Error(`远端找不到 ${defaultBranch} 分支，任务没有基点`);
}

export async function prepareRepoWorkspace(
  options: RepoWorkspaceOptions
): Promise<RepoWorkspace> {
  const dir = path.join(
    options.baseDir,
    projectDirName(options.projectPath)
  );
  const credential = writeCredentialFile(options.repoUrl, options.token);
  const env = gitEnv();
  const authArgs = [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=store --file=${credential.helperPath}`,
  ];

  try {
    fs.mkdirSync(options.baseDir, { recursive: true });
    let cloned = false;
    if (!fs.existsSync(path.join(dir, ".git"))) {
      fs.mkdirSync(dir, { recursive: true });
      await runGit(
        [...authArgs, "clone", "--origin", "origin", options.repoUrl, "."],
        dir,
        env
      );
      cloned = true;
      log.info("[gitlab-bot] 已克隆仓库", { project: options.projectPath, dir });
    } else {
      await runGit([...authArgs, "fetch", "--prune", "origin"], dir, env);
    }

    const defaultBranch = await resolveDefaultBranch(
      options.defaultBranch,
      dir,
      env,
      authArgs
    );
    const workBranch = options.branch || defaultBranch;

    await runGit([...authArgs, "reset", "--hard"], dir, env);
    await runGit([...authArgs, "clean", "-fd"], dir, env);

    const remoteHeads = await tryGit(
      [...authArgs, "ls-remote", "--heads", "origin", workBranch],
      dir,
      env
    );

    if (remoteHeads && remoteHeads.trim()) {
      await runGit(
        [...authArgs, "fetch", "origin", workBranch],
        dir,
        env
      );
      await runGit(
        [...authArgs, "checkout", "-B", workBranch, `origin/${workBranch}`],
        dir,
        env
      );
    } else {
      const base = await resolveBaseCommit(defaultBranch, dir, env, authArgs);
      await runGit([...authArgs, "checkout", "-B", workBranch, base], dir, env);
    }

    await runGit([...authArgs, "reset", "--hard"], dir, env);
    await runGit([...authArgs, "clean", "-fd"], dir, env);

    return { dir, branch: workBranch, cloned };
  } finally {
    credential.cleanup();
  }
}
