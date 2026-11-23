import type {
  PluginCapabilities,
  PluginCommandContribution,
  PluginContributes,
  PluginDataAccess,
  PluginManifest,
  PluginRuntimeConfig,
  PluginSettingContribution,
  PluginSidebarContribution,
} from "./pluginTypes";
import { parsePluginPreview } from "./pluginPreview";

export const PLUGIN_MANIFEST_FILENAME = "plugin.json";
export const LEGACY_MANIFEST_FILENAME = "qnote.json";

const MAX_COMMAND_LENGTH = 2000;
const MAX_ID_LENGTH = 128;
const ID_PATTERN = /^(?!.*[A-Z])[\p{L}\p{N}][\p{L}\p{N}.-]*$/u;

export interface ManifestParseResult {
  manifest: PluginManifest | null;
  error?: string;
  raw?: string;
  missing?: boolean;
}

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function parseSemver(text: string): Semver | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      text.trim()
    );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftIsNumber = /^\d+$/.test(left);
    const rightIsNumber = /^\d+$/.test(right);
    if (leftIsNumber && rightIsNumber) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff;
      continue;
    }
    if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

interface PartialVersion {
  semver: Semver;
  hasMinor: boolean;
  hasPatch: boolean;
}

function parsePartial(text: string): PartialVersion | null {
  const trimmed = text.trim().replace(/^v/, "");
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed);
  if (!match) return null;
  return {
    semver: {
      major: Number(match[1]),
      minor: match[2] === undefined ? 0 : Number(match[2]),
      patch: match[3] === undefined ? 0 : Number(match[3]),
      prerelease: match[4] ? match[4].split(".") : [],
    },
    hasMinor: match[2] !== undefined,
    hasPatch: match[3] !== undefined,
  };
}

function satisfiesComparator(version: Semver, comparator: string): boolean {
  const text = comparator.trim();
  if (!text || text === "*" || text === "x" || text === "X") return true;

  if (text.startsWith("^")) {
    const parsedBase = parsePartial(text.slice(1));
    if (!parsedBase) return false;
    const base = parsedBase.semver;
    if (compareSemver(version, base) < 0) return false;
    let upper: Semver;
    if (base.major > 0) {
      upper = { major: base.major + 1, minor: 0, patch: 0, prerelease: [] };
    } else if (!parsedBase.hasMinor) {
      upper = { major: 1, minor: 0, patch: 0, prerelease: [] };
    } else if (base.minor > 0) {
      upper = { major: 0, minor: base.minor + 1, patch: 0, prerelease: [] };
    } else if (!parsedBase.hasPatch) {
      upper = { major: 0, minor: 1, patch: 0, prerelease: [] };
    } else {
      upper = { major: 0, minor: 0, patch: base.patch + 1, prerelease: [] };
    }
    return compareSemver(version, upper) < 0;
  }

  if (text.startsWith("~")) {
    const parsedBase = parsePartial(text.slice(1));
    if (!parsedBase) return false;
    const base = parsedBase.semver;
    if (compareSemver(version, base) < 0) return false;
    const upper = parsedBase.hasMinor
      ? { major: base.major, minor: base.minor + 1, patch: 0, prerelease: [] }
      : { major: base.major + 1, minor: 0, patch: 0, prerelease: [] };
    return compareSemver(version, upper) < 0;
  }

  const trimmed = text.trim();
  const operatorMatch = /^(>=|<=|>|<|=)?/.exec(trimmed);
  if (!operatorMatch) return false;
  const operator = operatorMatch[1] ?? "=";
  const parsedBase = parsePartial(trimmed.slice(operatorMatch[1]?.length ?? 0));
  if (!parsedBase) return false;
  const diff = compareSemver(version, parsedBase.semver);
  switch (operator) {
    case ">=":
      return diff >= 0;
    case ">":
      return diff > 0;
    case "<=":
      return diff <= 0;
    case "<":
      return diff < 0;
    default:
      return diff === 0;
  }
}

export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  const trimmed = range.trim();
  if (!trimmed || trimmed === "*") return true;
  return trimmed.split("||").some((alternative) => {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) return true;
    return comparators.every((comparator) => satisfiesComparator(parsed, comparator));
  });
}

export function isValidPluginId(id: string): boolean {
  if (!id || id.length > MAX_ID_LENGTH) return false;
  if (!ID_PATTERN.test(id)) return false;
  if (id.includes("..")) return false;
  return id.includes(".");
}

function fail(raw: string, error: string): ManifestParseResult {
  return { manifest: null, error, raw };
}

function parseRuntime(value: unknown): { runtime?: PluginRuntimeConfig; error?: string } {
  if (value === undefined) return { error: "runtime 是必填项" };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "runtime 必须是一个对象" };
  }
  const source = value as Record<string, unknown>;
  const runtime: PluginRuntimeConfig = {};

  if (source.command !== undefined) {
    if (typeof source.command !== "string") {
      return { error: "runtime.command 必须是字符串" };
    }
    const command = source.command.trim();
    if (!command) return { error: "runtime.command 不能为空" };
    if (command.length > MAX_COMMAND_LENGTH) {
      return { error: "runtime.command 太长了" };
    }
    runtime.command = command;
  }

  if (source.args !== undefined) {
    if (!Array.isArray(source.args) || source.args.some((a) => typeof a !== "string")) {
      return { error: "runtime.args 必须是字符串数组" };
    }
    const args = source.args.map((a) => a.trim()).filter((a) => a.length > 0);
    if (args.length > 0) runtime.args = args;
  }

  if (source.cwd !== undefined) {
    if (typeof source.cwd !== "string") {
      return { error: "runtime.cwd 必须是字符串" };
    }
    const cwd = source.cwd.trim();
    if (cwd) runtime.cwd = cwd;
  }

  if (source.env !== undefined) {
    if (typeof source.env !== "object" || source.env === null || Array.isArray(source.env)) {
      return { error: "runtime.env 必须是一个对象" };
    }
    const env: Record<string, string> = {};
    for (const [key, item] of Object.entries(source.env as Record<string, unknown>)) {
      if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
        return { error: `runtime.env.${key} 必须是字符串` };
      }
      const name = key.trim();
      if (!name) continue;
      env[name] = String(item);
    }
    if (Object.keys(env).length > 0) runtime.env = env;
  }

  if (source.preview !== undefined) {
    const preview = parsePluginPreview(source.preview);
    if (!preview) {
      return {
        error:
          'runtime.preview 必须是 { "type": "port", "port": 7799 } / { "type": "url", "url": "..." } / { "type": "path", "path": "..." } 三选一',
      };
    }
    runtime.preview = preview;
  }

  if (!runtime.command && !runtime.preview) {
    return { error: "runtime.command 和 runtime.preview 至少要填一个" };
  }

  return { runtime };
}

const CAPABILITY_KEYS = ["process", "network", "filesystem", "qnote"];
const DATA_ACCESS_BY_KEY: Record<string, PluginDataAccess[]> = {
  notes: ["none", "read", "write"],
  todos: ["none", "read", "write"],
  clipboard: ["none", "read"],
  ai: ["none", "read"],
};

function parseCapabilities(value: unknown): { capabilities?: PluginCapabilities; error?: string } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "capabilities 必须是一个对象" };
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!CAPABILITY_KEYS.includes(key)) {
      return {
        error: `capabilities.${key} 不是已知的能力名（可用：${CAPABILITY_KEYS.join("、")}）`,
      };
    }
  }

  const capabilities: PluginCapabilities = {};

  if (source.process !== undefined) {
    if (typeof source.process !== "object" || source.process === null || Array.isArray(source.process)) {
      return { error: "capabilities.process 必须是一个对象" };
    }
    const process = source.process as Record<string, unknown>;
    for (const key of Object.keys(process)) {
      if (key !== "spawn" && key !== "env") {
        return { error: `capabilities.process.${key} 不是已知的能力名` };
      }
    }
    const value_: PluginCapabilities["process"] = {};
    if (process.spawn !== undefined) {
      if (typeof process.spawn !== "boolean") {
        return { error: "capabilities.process.spawn 必须是布尔值" };
      }
      value_.spawn = process.spawn;
    }
    if (process.env !== undefined) {
      if (!Array.isArray(process.env) || process.env.some((e) => typeof e !== "string")) {
        return { error: "capabilities.process.env 必须是字符串数组" };
      }
      value_.env = process.env.map((e) => e.trim()).filter(Boolean);
    }
    capabilities.process = value_;
  }

  if (source.network !== undefined) {
    if (!Array.isArray(source.network) || source.network.some((n) => typeof n !== "string")) {
      return { error: "capabilities.network 必须是字符串数组" };
    }
    capabilities.network = source.network.map((n) => n.trim()).filter(Boolean);
  }

  if (source.filesystem !== undefined) {
    if (typeof source.filesystem !== "object" || source.filesystem === null || Array.isArray(source.filesystem)) {
      return { error: "capabilities.filesystem 必须是一个对象" };
    }
    const filesystem = source.filesystem as Record<string, unknown>;
    for (const key of Object.keys(filesystem)) {
      if (key !== "read" && key !== "write") {
        return { error: `capabilities.filesystem.${key} 不是已知的能力名` };
      }
    }
    const value_: PluginCapabilities["filesystem"] = {};
    for (const key of ["read", "write"] as const) {
      const list = filesystem[key];
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.some((item) => typeof item !== "string")) {
        return { error: `capabilities.filesystem.${key} 必须是字符串数组` };
      }
      value_[key] = list.map((item) => item.trim()).filter(Boolean);
    }
    capabilities.filesystem = value_;
  }

  if (source.qnote !== undefined) {
    if (typeof source.qnote !== "object" || source.qnote === null || Array.isArray(source.qnote)) {
      return { error: "capabilities.qnote 必须是一个对象" };
    }
    const qnote = source.qnote as Record<string, unknown>;
    for (const key of Object.keys(qnote)) {
      if (!DATA_ACCESS_BY_KEY[key]) {
        return { error: `capabilities.qnote.${key} 不是已知的能力名` };
      }
    }
    const value_: NonNullable<PluginCapabilities["qnote"]> = {};
    for (const [key, allowed] of Object.entries(DATA_ACCESS_BY_KEY)) {
      const item = qnote[key];
      if (item === undefined) continue;
      if (typeof item !== "string" || !allowed.includes(item as PluginDataAccess)) {
        return { error: `capabilities.qnote.${key} 只能是 ${allowed.join(" / ")}` };
      }
      value_[key] = item as PluginDataAccess;
    }
    capabilities.qnote = value_;
  }

  return { capabilities };
}

function parseContributes(value: unknown): { contributes?: PluginContributes; error?: string } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "contributes 必须是一个对象" };
  }
  const source = value as Record<string, unknown>;
  const contributes: PluginContributes = {};

  if (source.commands !== undefined) {
    if (!Array.isArray(source.commands)) {
      return { error: "contributes.commands 必须是数组" };
    }
    const commands: PluginCommandContribution[] = [];
    for (const item of source.commands) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return { error: "contributes.commands 的每一项都必须是对象" };
      }
      const entry = item as Record<string, unknown>;
      if (typeof entry.command !== "string" || !entry.command.trim()) {
        return { error: "contributes.commands 里的 command 必须是非空字符串" };
      }
      if (typeof entry.title !== "string" || !entry.title.trim()) {
        return { error: `contributes.commands 里的 ${entry.command} 缺少 title` };
      }
      commands.push({
        command: entry.command.trim(),
        title: entry.title.trim(),
        category: typeof entry.category === "string" ? entry.category.trim() : undefined,
        icon: typeof entry.icon === "string" ? entry.icon.trim() : undefined,
      });
    }
    contributes.commands = commands;
  }

  if (source.settings !== undefined) {
    if (!Array.isArray(source.settings)) {
      return { error: "contributes.settings 必须是数组" };
    }
    const settings: PluginSettingContribution[] = [];
    for (const item of source.settings) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return { error: "contributes.settings 的每一项都必须是对象" };
      }
      const entry = item as Record<string, unknown>;
      if (typeof entry.key !== "string" || !entry.key.trim()) {
        return { error: "contributes.settings 里的 key 必须是非空字符串" };
      }
      const type = entry.type;
      if (type !== "string" && type !== "number" && type !== "boolean") {
        return { error: `contributes.settings 里的 ${entry.key} 的 type 只能是 string / number / boolean` };
      }
      settings.push({
        key: entry.key.trim(),
        type,
        default: entry.default as string | number | boolean | undefined,
        title: typeof entry.title === "string" ? entry.title.trim() : undefined,
        description: typeof entry.description === "string" ? entry.description.trim() : undefined,
      });
    }
    contributes.settings = settings;
  }

  if (source.sidebar !== undefined) {
    if (!Array.isArray(source.sidebar)) {
      return { error: "contributes.sidebar 必须是数组" };
    }
    const sidebar: PluginSidebarContribution[] = [];
    for (const item of source.sidebar) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return { error: "contributes.sidebar 的每一项都必须是对象" };
      }
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || !entry.id.trim()) {
        return { error: "contributes.sidebar 里的 id 必须是非空字符串" };
      }
      if (typeof entry.title !== "string" || !entry.title.trim()) {
        return { error: `contributes.sidebar 里的 ${entry.id} 缺少 title` };
      }
      sidebar.push({
        id: entry.id.trim(),
        title: entry.title.trim(),
        icon: typeof entry.icon === "string" ? entry.icon.trim() : undefined,
      });
    }
    contributes.sidebar = sidebar;
  }

  return { contributes };
}

export function parsePluginManifest(text: string): ManifestParseResult {
  const raw = text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail(raw, `${PLUGIN_MANIFEST_FILENAME} 不是合法的 JSON：${detail}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail(raw, `${PLUGIN_MANIFEST_FILENAME} 的顶层必须是一个对象`);
  }

  const source = parsed as Record<string, unknown>;
  const manifest: PluginManifest = {
    id: "",
    name: "",
    version: "",
    publisher: "",
    engines: { qnote: "" },
    runtime: {},
  };

  if (typeof source.id !== "string" || !source.id.trim()) {
    return fail(raw, "id 是必填项");
  }
  const id = source.id.trim();
  if (!isValidPluginId(id)) {
    return fail(raw, "id 必须是 publisher.name 格式（只允许小写字母、数字、. 和 -，且必须含一个 .）");
  }
  manifest.id = id;

  if (typeof source.name !== "string" || !source.name.trim()) {
    return fail(raw, "name 是必填项");
  }
  manifest.name = source.name.trim();

  if (typeof source.version !== "string" || !source.version.trim()) {
    return fail(raw, "version 是必填项");
  }
  const version = source.version.trim();
  if (!parseSemver(version)) {
    return fail(raw, "version 必须是 MAJOR.MINOR.PATCH 格式的语义化版本");
  }
  manifest.version = version;

  if (typeof source.publisher !== "string" || !source.publisher.trim()) {
    return fail(raw, "publisher 是必填项");
  }
  manifest.publisher = source.publisher.trim();

  if (typeof source.description === "string") {
    const description = source.description.trim();
    if (description) manifest.description = description;
  } else if (source.description !== undefined) {
    return fail(raw, "description 必须是字符串");
  }

  if (typeof source.license === "string") {
    const license = source.license.trim();
    if (license) manifest.license = license;
  } else if (source.license !== undefined) {
    return fail(raw, "license 必须是字符串");
  }

  if (typeof source.icon === "string") {
    const icon = source.icon.trim();
    if (icon) manifest.icon = icon;
  } else if (source.icon !== undefined) {
    return fail(raw, "icon 必须是字符串");
  }

  if (typeof source.engines !== "object" || source.engines === null || Array.isArray(source.engines)) {
    return fail(raw, "engines 是必填项");
  }
  const engines = source.engines as Record<string, unknown>;
  if (typeof engines.qnote !== "string" || !engines.qnote.trim()) {
    return fail(raw, "engines.qnote 是必填项（写宿主版本约束，例如 ^2.0.0）");
  }
  manifest.engines.qnote = engines.qnote.trim();

  if (source.activationEvents !== undefined) {
    if (!Array.isArray(source.activationEvents) || source.activationEvents.some((e) => typeof e !== "string")) {
      return fail(raw, "activationEvents 必须是字符串数组");
    }
    manifest.activationEvents = source.activationEvents.map((e) => e.trim()).filter(Boolean);
  }

  const runtimeResult = parseRuntime(source.runtime);
  if (runtimeResult.error || !runtimeResult.runtime) {
    return fail(raw, runtimeResult.error ?? "runtime 不合法");
  }
  manifest.runtime = runtimeResult.runtime;

  const capabilitiesResult = parseCapabilities(source.capabilities);
  if (capabilitiesResult.error) return fail(raw, capabilitiesResult.error);
  if (capabilitiesResult.capabilities) manifest.capabilities = capabilitiesResult.capabilities;

  const contributesResult = parseContributes(source.contributes);
  if (contributesResult.error) return fail(raw, contributesResult.error);
  if (contributesResult.contributes) manifest.contributes = contributesResult.contributes;

  if (source.extensionDependencies !== undefined) {
    if (
      !Array.isArray(source.extensionDependencies) ||
      source.extensionDependencies.some((d) => typeof d !== "string")
    ) {
      return fail(raw, "extensionDependencies 必须是字符串数组");
    }
    manifest.extensionDependencies = source.extensionDependencies
      .map((d) => d.trim())
      .filter(Boolean);
  }

  return { manifest, raw };
}

export function buildPluginCommandLine(runtime: PluginRuntimeConfig): string {
  const parts = [runtime.command ?? ""];
  for (const arg of runtime.args ?? []) {
    parts.push(/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
  }
  return parts.join(" ").trim();
}
