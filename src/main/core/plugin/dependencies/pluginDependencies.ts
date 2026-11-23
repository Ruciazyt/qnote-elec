import {
  isValidPluginId,
  satisfiesRange,
} from "../../../../shared/plugin/manifest/pluginManifest";

export interface PluginDependencySpec {
  id: string;
  range?: string;
  raw: string;
}

export type PluginDependencyIssueReason = "missing" | "version" | "invalid";

export interface PluginDependencyIssue {
  spec: PluginDependencySpec;
  reason: PluginDependencyIssueReason;
  installedVersion?: string;
}

export interface PluginDependencyReport {
  ok: boolean;
  issues: PluginDependencyIssue[];
}

export function parseDependencySpec(raw: string): PluginDependencySpec | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  const at = trimmed.indexOf("@");
  const id = (at === -1 ? trimmed : trimmed.slice(0, at)).trim();
  const range = (at === -1 ? "" : trimmed.slice(at + 1)).trim();
  if (!isValidPluginId(id)) return null;
  if (at !== -1 && !range) return null;

  return { id, range: range || undefined, raw: trimmed };
}

export function checkPluginDependencies(
  dependencies: string[] | undefined,
  installed: Map<string, string>
): PluginDependencyReport {
  const issues: PluginDependencyIssue[] = [];

  for (const raw of dependencies ?? []) {
    const spec = parseDependencySpec(raw);
    if (!spec) {
      issues.push({
        spec: { id: String(raw ?? "").trim(), raw: String(raw ?? "") },
        reason: "invalid",
      });
      continue;
    }

    const version = installed.get(spec.id);
    if (!version) {
      issues.push({ spec, reason: "missing" });
      continue;
    }
    if (spec.range && !satisfiesRange(version, spec.range)) {
      issues.push({ spec, reason: "version", installedVersion: version });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function formatDependencyIssues(issues: PluginDependencyIssue[]): string {
  const parts = issues.map((issue) => {
    if (issue.reason === "missing") {
      const wanted = issue.spec.range ? `@${issue.spec.range}` : "";
      return `缺少依赖插件 ${issue.spec.id}${wanted}`;
    }
    if (issue.reason === "version") {
      return `依赖插件 ${issue.spec.id} 的版本不满足要求（要 ${issue.spec.range}，当前是 ${issue.installedVersion}）`;
    }
    return `依赖声明「${issue.spec.raw}」写得不对`;
  });
  return `${parts.join("；")}。请到插件市场手动装好依赖后再启动这个插件。`;
}
