import type { PluginCapabilities, PluginDataAccess } from "../../../../shared/plugin/manifest/pluginTypes";
import {
  grantKeyForAreaAccess,
  spawnGrantKey,
} from "../../../../shared/plugin/permissions/pluginCapabilities";

export type CapabilityArea = "notes" | "todos" | "clipboard" | "ai";

export type CapabilityRequest =
  | { kind: "spawn" }
  | { kind: "data"; area: CapabilityArea; access: "read" | "write" };

export interface CapabilityDecision {
  allowed: boolean;
  reason?: string;
}

const AREA_LABEL: Record<CapabilityArea, string> = {
  notes: "笔记",
  todos: "待办",
  clipboard: "剪贴板",
  ai: "AI",
};

export function checkCapability(
  capabilities: PluginCapabilities | undefined,
  request: CapabilityRequest
): CapabilityDecision {
  if (request.kind === "spawn") {
    if (capabilities?.process?.spawn === true) return { allowed: true };
    return {
      allowed: false,
      reason: "这个插件没有声明 process.spawn 权限，不能启动子进程",
    };
  }

  const declared: PluginDataAccess | undefined =
    capabilities?.qnote?.[request.area] ?? "none";
  if (declared === "none") {
    return {
      allowed: false,
      reason: `这个插件没有声明访问${AREA_LABEL[request.area]}的权限`,
    };
  }
  if (request.access === "write" && declared !== "write") {
    return {
      allowed: false,
      reason: `这个插件只有${AREA_LABEL[request.area]}的只读权限，不能写入`,
    };
  }
  return { allowed: true };
}

export function grantKeyForRequest(request: CapabilityRequest): string {
  if (request.kind === "spawn") return spawnGrantKey();
  return grantKeyForAreaAccess(request.area, request.access);
}

export function describeCapabilities(
  capabilities: PluginCapabilities | undefined
): string[] {
  if (!capabilities) return [];
  const lines: string[] = [];
  if (capabilities.process?.spawn) {
    lines.push("启动子进程");
  }
  if (capabilities.process?.env?.length) {
    lines.push(`设置环境变量 ${capabilities.process.env.join("、")}`);
  }
  if (capabilities.network?.length) {
    lines.push(`访问网络 ${capabilities.network.join("、")}`);
  }
  const qnote = capabilities.qnote;
  if (qnote) {
    for (const area of Object.keys(AREA_LABEL) as CapabilityArea[]) {
      const access = qnote[area];
      if (!access || access === "none") continue;
      lines.push(`${access === "write" ? "读写" : "读取"}${AREA_LABEL[area]}`);
    }
  }
  return lines;
}
