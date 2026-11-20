import type { PluginCapabilities } from "@shared/plugin/pluginTypes";

export interface CapabilityEntry {
  area: string;
  detail: string;
}

export function describeCapabilities(
  capabilities?: PluginCapabilities
): CapabilityEntry[] {
  if (!capabilities) return [];
  const entries: CapabilityEntry[] = [];

  if (capabilities.process?.spawn) {
    entries.push({ area: "进程", detail: "启动子进程" });
  }
  if (capabilities.process?.env?.length) {
    entries.push({
      area: "进程",
      detail: `设置环境变量 ${capabilities.process.env.join("、")}`,
    });
  }
  if (capabilities.network?.length) {
    entries.push({
      area: "网络",
      detail: `访问网络 ${capabilities.network.join("、")}`,
    });
  }
  if (capabilities.filesystem?.read?.length) {
    entries.push({
      area: "文件",
      detail: `读取文件 ${capabilities.filesystem.read.join("、")}`,
    });
  }
  if (capabilities.filesystem?.write?.length) {
    entries.push({
      area: "文件",
      detail: `写入文件 ${capabilities.filesystem.write.join("、")}`,
    });
  }

  const qnote = capabilities.qnote;
  if (qnote) {
    if (qnote.notes && qnote.notes !== "none") {
      entries.push({
        area: "QNote 数据",
        detail: `${qnote.notes === "write" ? "读写" : "读取"}笔记`,
      });
    }
    if (qnote.todos && qnote.todos !== "none") {
      entries.push({
        area: "QNote 数据",
        detail: `${qnote.todos === "write" ? "读写" : "读取"}待办`,
      });
    }
    if (qnote.clipboard === "read") {
      entries.push({ area: "QNote 数据", detail: "读取剪贴板" });
    }
    if (qnote.ai === "read") {
      entries.push({ area: "QNote 数据", detail: "读取 AI 会话" });
    }
  }

  return entries;
}

export function capabilitySummary(capabilities?: PluginCapabilities): string[] {
  return describeCapabilities(capabilities).map((entry) => entry.detail);
}
