import { createRequire } from "node:module";
import * as http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { ToolDefinition } from "../../tools/tool";
import { log } from "../../../system/log";
import { prepareEnabledTools } from "../../tools/registry";
import {
  describeToolResult,
  toMcpToolDescriptor,
  type McpToolDescriptor,
} from "./registry";

interface McpServerLike {
  connect(transport: unknown): Promise<void>;
  setRequestHandler(
    schema: unknown,
    handler: (request: any) => Promise<unknown>
  ): void;
  close(): Promise<void>;
}

interface McpTransportLike {
  handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedBody?: unknown
  ): Promise<void>;
  close(): Promise<void>;
}

interface McpSdkServer {
  Server: new (
    info: { name: string; version: string },
    options?: unknown
  ) => McpServerLike;
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
  StreamableHTTPServerTransport: new (options?: unknown) => McpTransportLike;
}

interface McpSession {
  server: McpServerLike;
  transport: McpTransportLike;
}

let cachedSdk: McpSdkServer | null = null;

export function loadMcpServerSdk(): McpSdkServer {
  if (cachedSdk) return cachedSdk;
  const nodeRequire = createRequire(__filename);
  const types = nodeRequire("@modelcontextprotocol/sdk/types.js");
  cachedSdk = {
    Server: nodeRequire("@modelcontextprotocol/sdk/server/index.js").Server,
    ListToolsRequestSchema: types.ListToolsRequestSchema,
    CallToolRequestSchema: types.CallToolRequestSchema,
    StreamableHTTPServerTransport:
      nodeRequire("@modelcontextprotocol/sdk/server/streamableHttp.js")
        .StreamableHTTPServerTransport,
  };
  return cachedSdk;
}

export type McpToolProvider = () => Promise<ToolDefinition[]>;

export interface QnoteMcpServerOptions {
  tools?: ToolDefinition[];
  toolProvider?: McpToolProvider;
  token?: string;
  version?: string;
}

export interface QnoteMcpEndpoint {
  port: number;
  url: string;
  token: string;
  toolNames: string[];
}

export class QnoteMcpServer {
  private httpServer: http.Server | null = null;
  private sessions = new Map<string, McpSession>();
  private token = "";
  private descriptors: McpToolDescriptor[] = [];
  private toolsByName = new Map<string, ToolDefinition>();
  private readonly toolProvider: McpToolProvider;

  constructor(private readonly options: QnoteMcpServerOptions) {
    const fixed = options.tools;
    this.toolProvider =
      options.toolProvider ??
      (fixed ? async () => fixed : () => prepareEnabledTools());
  }

  async start(): Promise<QnoteMcpEndpoint> {
    this.token = this.options.token || randomBytes(24).toString("hex");
    await this.refreshTools();

    const port = await this.listen();
    const url = `http://127.0.0.1:${port}/mcp`;
    log.info("[mcp] QNote 工具服务已启动", {
      url,
      tools: this.descriptors.length,
    });
    return {
      port,
      url,
      token: this.token,
      toolNames: this.descriptors.map((d) => d.name),
    };
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer;
    this.httpServer = null;
    for (const session of this.sessions.values()) {
      try {
        await session.transport.close();
      } catch {
        // ignore
      }
      try {
        await session.server.close();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
    if (httpServer) {
      const closable = httpServer as http.Server & {
        closeAllConnections?: () => void;
      };
      try {
        closable.closeAllConnections?.();
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    log.info("[mcp] QNote 工具服务已停止");
  }

  private async refreshTools(): Promise<void> {
    const tools = await this.toolProvider();
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    this.descriptors = tools.map(toMcpToolDescriptor);
  }

  private async createSession(): Promise<McpSession> {
    const sdk = loadMcpServerSdk();
    const server = new sdk.Server(
      { name: "qnote", version: this.options.version || "1.0.0" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(sdk.ListToolsRequestSchema, async () => {
      await this.refreshTools();
      return { tools: this.descriptors };
    });

    server.setRequestHandler(
      sdk.CallToolRequestSchema,
      async (request: any) => {
        const name = request?.params?.name;
        const args = request?.params?.arguments ?? {};
        let tool = this.toolsByName.get(name);
        if (!tool) {
          await this.refreshTools();
          tool = this.toolsByName.get(name);
        }
        if (!tool) {
          return {
            content: [{ type: "text", text: `未知工具：${String(name)}` }],
            isError: true,
          };
        }
        try {
          const result = await tool.invoke(args);
          return {
            content: [{ type: "text", text: describeToolResult(result) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `工具执行错误：${message}` }],
            isError: true,
          };
        }
      }
    );

    const holder: { transport?: McpTransportLike } = {};
    const transport = new sdk.StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        if (!holder.transport) return;
        this.sessions.set(sessionId, { server, transport: holder.transport });
      },
    });
    holder.transport = transport;

    await server.connect(transport);
    return { server, transport };
  }

  private listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.httpServer = server;
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        if (port) resolve(port);
        else reject(new Error("MCP 服务没拿到端口"));
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const pathname = (req.url || "").split("?")[0];
    if (pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const authorization = req.headers.authorization || "";
    if (authorization !== `Bearer ${this.token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await readJsonBody(req);
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          })
        );
        return;
      }
    }

    const sessionId = req.headers["mcp-session-id"];
    let session: McpSession | undefined;

    if (typeof sessionId === "string" && sessionId) {
      session = this.sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "session not found" }));
        return;
      }
    } else if (isInitializeRequest(body)) {
      session = await this.createSession();
    } else {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing mcp-session-id" }));
      return;
    }

    try {
      await session.transport.handleRequest(req, res, body);
    } catch (err) {
      log.error("[mcp] 请求处理失败", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    }
  }
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as { method?: string }).method === "initialize";
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return undefined;
  return JSON.parse(text);
}
