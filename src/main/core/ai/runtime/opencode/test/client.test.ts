// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "",
    getVersion: () => "0.0.0",
  },
}));

import * as http from "node:http";
import { OpencodeClient, OpencodeRequestError } from "../client";

interface Capture {
  method: string;
  url: string;
  body: any;
  auth?: string;
}

let server: http.Server;
let baseUrl = "";
let captures: Capture[] = [];
let responder: (req: http.IncomingMessage, res: http.ServerResponse) => void = (
  _req,
  res
) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      captures.push({
        method: req.method || "",
        url: req.url || "",
        body,
        auth: req.headers.authorization,
      });
      responder(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function createClient() {
  return new OpencodeClient({
    baseUrl,
    credentials: { username: "qnote", password: "secret" },
  });
}

describe("OpencodeClient", () => {
  it("建会话时带 basic 鉴权与模型", async () => {
    captures = [];
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "ses_1" }));
    };

    const session = await createClient().createSession({
      title: "QNote",
      model: { providerID: "opencode", modelID: "big-pickle" },
    });

    expect(session.id).toBe("ses_1");
    expect(captures[0].method).toBe("POST");
    expect(captures[0].url).toBe("/session");
    expect(captures[0].body.model).toEqual({
      id: "big-pickle",
      providerID: "opencode",
    });
    const expected = `Basic ${Buffer.from("qnote:secret").toString("base64")}`;
    expect(captures[0].auth).toBe(expected);
  });

  it("发消息时带 system 与 parts", async () => {
    captures = [];
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ info: { id: "msg_1" }, parts: [] }));
    };

    await createClient().sendMessage("ses_1", {
      system: "你是 QNote 助手",
      parts: [{ type: "text", text: "你好" }],
    });

    expect(captures[0].url).toBe("/session/ses_1/message");
    expect(captures[0].body.system).toBe("你是 QNote 助手");
    expect(captures[0].body.parts).toEqual([{ type: "text", text: "你好" }]);
  });

  it("非 2xx 抛 OpencodeRequestError", async () => {
    responder = (_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"message":"unauthorized"}');
    };

    await expect(createClient().health()).rejects.toBeInstanceOf(
      OpencodeRequestError
    );
  });

  it("订阅事件流并解析 SSE", async () => {
    responder = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"id":"evt_1","type":"server.connected","properties":{}}\n\n');
      res.write('data: {"id":"evt_2","type":"session.idle","properties":{"sessionID":"ses_1"}}\n\n');
    };

    const controller = new AbortController();
    const events: string[] = [];
    const client = createClient();

    const done = client.subscribeEvents(controller.signal, (event) => {
      events.push(event.type);
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    await done;

    expect(events).toContain("server.connected");
    expect(events).toContain("session.idle");
  });

  it("订阅事件流时带上会话目录", async () => {
    const urls: string[] = [];
    responder = (req, res) => {
      urls.push(req.url || "");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"id":"evt_1","type":"server.connected","properties":{}}\n\n');
    };

    const controller = new AbortController();
    const client = createClient();
    const done = client.subscribeEvents(
      controller.signal,
      () => undefined,
      { directory: "C:\\repos\\demo" }
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    await done;

    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toContain("directory=");
    expect(decodeURIComponent(urls[0])).toContain("C:\\repos\\demo");
  });
});
