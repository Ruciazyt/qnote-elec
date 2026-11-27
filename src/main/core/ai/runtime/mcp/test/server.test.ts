// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "",
    getVersion: () => "0.0.0",
  },
}));

import { createRequire } from "node:module";
import { z } from "zod";
import { tool } from "../../../tools/tool";
import { QnoteMcpServer, type QnoteMcpEndpoint } from "../server";

const nodeRequire = createRequire(__filename);

const echoTool = tool(async (input: { text: string }) => `收到：${input.text}`, {
  name: "echo",
  description: "回显输入的文本",
  schema: z.object({ text: z.string().describe("要回显的文本") }),
});

const listTool = tool(async () => JSON.stringify({ count: 2 }), {
  name: "list_items",
  description: "列出条目",
  schema: z.object({}),
});

let server: QnoteMcpServer;
let endpoint: QnoteMcpEndpoint;

beforeAll(async () => {
  server = new QnoteMcpServer({ tools: [echoTool, listTool] });
  endpoint = await server.start();
});

afterAll(async () => {
  await server.stop();
});

function createClient() {
  const { Client } = nodeRequire("@modelcontextprotocol/sdk/client/index.js");
  const {
    StreamableHTTPClientTransport,
  } = nodeRequire("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "qnote-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${endpoint.token}` },
    },
  });
  return { client, transport };
}

describe("QnoteMcpServer", () => {
  it("暴露工具清单与 JSON Schema", async () => {
    const { client, transport } = createClient();
    await client.connect(transport);

    const listed = await client.listTools();
    const names = listed.tools.map((t: any) => t.name);
    expect(names).toContain("echo");
    expect(names).toContain("list_items");

    const echo = listed.tools.find((t: any) => t.name === "echo");
    expect(echo.description).toBe("回显输入的文本");
    expect(echo.inputSchema.type).toBe("object");
    expect(Object.keys(echo.inputSchema.properties || {})).toContain("text");

    await client.close();
  }, 20000);

  it("调用工具返回文本结果", async () => {
    const { client, transport } = createClient();
    await client.connect(transport);

    const result: any = await client.callTool({
      name: "echo",
      arguments: { text: "你好" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("收到：你好");

    await client.close();
  }, 20000);

  it("未知工具返回 isError", async () => {
    const { client, transport } = createClient();
    await client.connect(transport);

    const result: any = await client.callTool({
      name: "not_exist",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("未知工具");

    await client.close();
  }, 20000);

  it("缺令牌直接被拒", async () => {
    const { Client } = nodeRequire("@modelcontextprotocol/sdk/client/index.js");
    const {
      StreamableHTTPClientTransport,
    } = nodeRequire("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const client = new Client({ name: "qnote-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url));

    await expect(client.connect(transport)).rejects.toBeTruthy();
    await client.close().catch(() => undefined);
  }, 20000);
});
