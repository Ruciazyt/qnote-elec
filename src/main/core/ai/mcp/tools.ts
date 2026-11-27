import { tool } from "../tools/tool";
import type { ToolDefinition } from "../tools/tool";
import { jsonSchemaToZod } from "./schema";
import type { McpToolInfo } from "./types";

export function buildMcpTool(params: {
  name: string;
  serverName: string;
  tool: McpToolInfo;
  invoke: (args: Record<string, unknown>) => Promise<string>;
}): ToolDefinition {
  const { name, serverName, tool: info, invoke } = params;
  const schema = jsonSchemaToZod(
    info.inputSchema ?? { type: "object", properties: {} }
  );
  const created = tool(
    async (args: any) => invoke((args ?? {}) as Record<string, unknown>),
    {
      name,
      description: `[MCP:${serverName}] ${info.description || info.name}`,
      schema: schema as any,
    }
  );
  return created as unknown as ToolDefinition;
}
