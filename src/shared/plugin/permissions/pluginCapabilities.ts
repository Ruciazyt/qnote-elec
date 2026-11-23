import type { PluginCapabilities } from "../manifest/pluginTypes";

export type PluginDataArea = "notes" | "todos" | "clipboard" | "ai";

export type PluginGrantAccess = "read" | "write";

export interface PluginCapabilityEntry {
  key: string;
  area: string;
  detail: string;
}

const AREA_LABEL: Record<PluginDataArea, string> = {
  notes: "笔记",
  todos: "待办",
  clipboard: "剪贴板",
  ai: "AI",
};

const DATA_AREAS = Object.keys(AREA_LABEL) as PluginDataArea[];

export function dataGrantKey(
  area: PluginDataArea,
  access: PluginGrantAccess
): string {
  return `qnote.${area}.${access}`;
}

export function spawnGrantKey(): string {
  return "process.spawn";
}

export function grantKeyForAreaAccess(
  area: PluginDataArea,
  access: PluginGrantAccess
): string {
  return dataGrantKey(area, access);
}

export function describeCapabilityEntries(
  capabilities?: PluginCapabilities
): PluginCapabilityEntry[] {
  if (!capabilities) return [];
  const entries: PluginCapabilityEntry[] = [];

  if (capabilities.process?.spawn) {
    entries.push({
      key: spawnGrantKey(),
      area: "进程",
      detail: "启动子进程",
    });
  }
  if (capabilities.process?.env?.length) {
    entries.push({
      key: "process.env",
      area: "进程",
      detail: `设置环境变量 ${capabilities.process.env.join("、")}`,
    });
  }
  if (capabilities.network?.length) {
    entries.push({
      key: "network",
      area: "网络",
      detail: `访问网络 ${capabilities.network.join("、")}`,
    });
  }
  if (capabilities.filesystem?.read?.length) {
    entries.push({
      key: "filesystem.read",
      area: "文件",
      detail: `读取文件 ${capabilities.filesystem.read.join("、")}`,
    });
  }
  if (capabilities.filesystem?.write?.length) {
    entries.push({
      key: "filesystem.write",
      area: "文件",
      detail: `写入文件 ${capabilities.filesystem.write.join("、")}`,
    });
  }

  const qnote = capabilities.qnote;
  if (qnote) {
    for (const area of DATA_AREAS) {
      const access = qnote[area];
      if (!access || access === "none") continue;
      entries.push({
        key: dataGrantKey(area, "read"),
        area: "QNote 数据",
        detail: `读取${AREA_LABEL[area]}`,
      });
      if (area === "ai") continue;
      if (access !== "write") continue;
      entries.push({
        key: dataGrantKey(area, "write"),
        area: "QNote 数据",
        detail: `写入${AREA_LABEL[area]}`,
      });
    }
  }

  return entries;
}

export function grantKeysForCapabilities(
  capabilities?: PluginCapabilities
): string[] {
  return describeCapabilityEntries(capabilities).map((entry) => entry.key);
}
