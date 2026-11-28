import * as fs from "node:fs";
import * as path from "node:path";
import { runnerDir } from "./paths";

export interface RunnerBinding {
  project: string;
  tags: string[];
  url: string;
}

export function runnerBindingPath(): string {
  return path.join(runnerDir(), "binding.json");
}

export function readRunnerBinding(): RunnerBinding | null {
  try {
    const raw = fs.readFileSync(runnerBindingPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<RunnerBinding>;
    if (typeof parsed?.project !== "string" || !parsed.project) return null;
    return {
      project: parsed.project,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      url: typeof parsed.url === "string" ? parsed.url : "",
    };
  } catch {
    return null;
  }
}

export function writeRunnerBinding(binding: RunnerBinding): void {
  try {
    fs.mkdirSync(runnerDir(), { recursive: true });
    fs.writeFileSync(runnerBindingPath(), JSON.stringify(binding), "utf8");
  } catch {
    // ignore
  }
}

export function bindingMatches(
  binding: RunnerBinding | null,
  expected: RunnerBinding
): boolean {
  if (!binding) return false;
  return (
    binding.project === expected.project &&
    binding.url === expected.url &&
    binding.tags.join(",") === expected.tags.join(",")
  );
}
