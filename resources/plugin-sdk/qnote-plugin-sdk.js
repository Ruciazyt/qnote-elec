const ENDPOINT = process.env.QNOTE_PLUGIN_RPC || "";
const TOKEN = process.env.QNOTE_PLUGIN_TOKEN || "";
const PLUGIN_ID = process.env.QNOTE_PLUGIN_ID || "";

const handlers = new Map();
const commands = new Map();
let nextId = 1;
let running = true;

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

async function poll() {
  while (running) {
    try {
      const res = await fetch(ENDPOINT + "/poll?token=" + encodeURIComponent(TOKEN));
      if (res.status === 204) continue;
      const request = await res.json();
      if (!request || !request.method) continue;
      const handler = handlers.get(request.method);
      if (!handler) {
        await post({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "插件没有实现 " + request.method },
        });
        continue;
      }
      try {
        const result = await handler(request.params || {});
        await post({ jsonrpc: "2.0", id: request.id, result: result ?? null });
      } catch (err) {
        await post({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32003, message: String(err && err.message ? err.message : err) },
        });
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
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

  void poll();

  return { definition, commands };
}

export default createPlugin;
