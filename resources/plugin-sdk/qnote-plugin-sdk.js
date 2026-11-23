import * as http from "node:http";

const ENDPOINT = process.env.QNOTE_PLUGIN_RPC || "";
const TOKEN = process.env.QNOTE_PLUGIN_TOKEN || "";
const PLUGIN_ID = process.env.QNOTE_PLUGIN_ID || "";

const handlers = new Map();
const commands = new Map();
let nextId = 1;

function post(payload) {
  return fetch(ENDPOINT + "/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qnote-token": TOKEN },
    body: JSON.stringify(payload),
  }).then((res) => res.json());
}

function call(method, params) {
  const id = nextId++;
  return post({ jsonrpc: "2.0", id, method, params: params || {} }).then((reply) => {
    if (reply && reply.error) {
      const err = new Error(reply.error.message || "宿主调用失败");
      err.code = reply.error.code;
      throw err;
    }
    return reply ? reply.result : null;
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function handleHostRequest(payload) {
  const handler = handlers.get(payload.method);
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: payload.id ?? null,
      error: { code: -32601, message: "插件没有实现 " + payload.method },
    };
  }
  try {
    const result = await handler(payload.params || {});
    return { jsonrpc: "2.0", id: payload.id ?? null, result: result ?? null };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id: payload.id ?? null,
      error: {
        code: -32003,
        message: String(err && err.message ? err.message : err),
      },
    };
  }
}

function startCallbackServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }
    if (req.headers["x-qnote-token"] !== TOKEN) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    void readBody(req)
      .then((raw) => {
        let payload = {};
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = {};
        }
        return handleHostRequest(payload);
      })
      .then((reply) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply));
      })
      .catch((err) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32603,
              message: String(err && err.message ? err.message : err),
            },
          })
        );
      });
  });

  server.on("error", (err) => {
    console.error("[qnote-plugin] 回调服务启动失败:", err);
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    void fetch(ENDPOINT + "/register-callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-qnote-token": TOKEN },
      body: JSON.stringify({ port }),
    }).catch((err) => {
      console.error("[qnote-plugin] 回调地址注册失败:", err);
    });
  });
}

function buildContext() {
  return {
    id: PLUGIN_ID,
    commands: {
      register(command, handler) {
        commands.set(command, handler);
        return { dispose() { commands.delete(command); } };
      },
      list() {
        return call("qnote.commands.list");
      },
      execute(command) {
        return call("qnote.commands.execute", { command });
      },
    },
    notifications: {
      info(message) { return call("qnote.notify", { level: "info", message }); },
      warn(message) { return call("qnote.notify", { level: "warn", message }); },
      error(message) { return call("qnote.notify", { level: "error", message }); },
    },
    log: {
      info(message) { return call("qnote.log", { level: "info", message }); },
      warn(message) { return call("qnote.log", { level: "warn", message }); },
      error(message) { return call("qnote.log", { level: "error", message }); },
    },
    settings: {
      get(key) { return call("qnote.settings.get", { key }); },
      set(key, value) { return call("qnote.settings.set", { key, value }); },
    },
    todos: {
      list(options) { return call("qnote.todos.list", options || {}); },
      create(input) { return call("qnote.todos.create", input || {}); },
      update(input) { return call("qnote.todos.update", input || {}); },
    },
    notes: {
      list(options) { return call("qnote.notes.list", options || {}); },
      get(pathOrOptions) {
        const params = typeof pathOrOptions === "string"
          ? { path: pathOrOptions }
          : (pathOrOptions || {});
        return call("qnote.notes.get", params);
      },
      create(input) { return call("qnote.notes.create", input || {}); },
      update(input) { return call("qnote.notes.update", input || {}); },
    },
    clipboard: {
      list(options) { return call("qnote.clipboard.list", options || {}); },
    },
    ai: {
      chat(input) { return call("qnote.ai.chat", input || {}); },
    },
  };
}

export function createPlugin(definition) {
  if (!ENDPOINT) {
    throw new Error("这个进程不是由 QNote 启动的：缺少 QNOTE_PLUGIN_RPC");
  }

  handlers.set("plugin.activate", async () => {
    const ctx = buildContext();
    if (typeof definition.activate === "function") {
      await definition.activate(ctx);
    }
    return { commands: Array.from(commands.keys()) };
  });

  handlers.set("plugin.deactivate", async () => {
    if (typeof definition.deactivate === "function") {
      await definition.deactivate();
    }
    commands.clear();
    return { ok: true };
  });

  handlers.set("qnote.command.invoke", async (params) => {
    const handler = commands.get(params && params.command);
    if (!handler) throw new Error("没有注册这个命令：" + (params && params.command));
    return handler(params && params.args);
  });

  startCallbackServer();

  return { definition, commands };
}

export default createPlugin;
