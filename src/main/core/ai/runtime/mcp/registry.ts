import { z } from "zod";
import type { ToolDefinition } from "../../tools/tool";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export function toJsonSchema(schema: unknown): Record<string, any> {
  try {
    const json = z.toJSONSchema(schema as any, {
      io: "input",
      target: "draft-7",
    });
    return json as Record<string, any>;
  } catch {
    return { type: "object", properties: {} };
  }
}

export function toMcpToolDescriptor(
  tool: ToolDefinition
): McpToolDescriptor {
  return {
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: toJsonSchema(tool.schema),
  };
}

export function describeToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
