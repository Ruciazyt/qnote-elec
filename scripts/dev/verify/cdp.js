class CdpClient {
    constructor(url) {
        this.url = url;
        this.nextId = 0;
        this.pending = new Map();
        this.listeners = new Map();
        this.socket = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const socket = new globalThis.WebSocket(this.url);
            this.socket = socket;
            socket.addEventListener("open", () => resolve(this));
            socket.addEventListener("error", () => reject(new Error(`CDP 连接失败: ${this.url}`)));
            socket.addEventListener("close", () => {
                for (const entry of this.pending.values()) {
                    entry.reject(new Error(`CDP 连接已关闭: ${entry.method}`));
                }
                this.pending.clear();
            });
            socket.addEventListener("message", (event) => {
                this.handleMessage(String(event.data));
            });
        });
    }

    handleMessage(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }
        if (message.id !== undefined) {
            const entry = this.pending.get(message.id);
            if (!entry) return;
            this.pending.delete(message.id);
            if (message.error) {
                entry.settle(entry.reject, new Error(`${entry.method} 失败: ${message.error.message}`));
            } else {
                entry.settle(entry.resolve, message.result);
            }
            return;
        }
        const handlers = this.listeners.get(message.method);
        if (!handlers) return;
        for (const handler of handlers) handler(message.params);
    }

    send(method, params = {}, timeoutMs = 15000) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const entry = { resolve, reject, method };
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} 超时（${timeoutMs}ms）`));
            }, timeoutMs);
            entry.settle = (fn, value) => {
                clearTimeout(timer);
                fn(value);
            };
            this.pending.set(id, entry);
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    on(method, handler) {
        const handlers = this.listeners.get(method) ?? [];
        handlers.push(handler);
        this.listeners.set(method, handlers);
    }

    close() {
        if (this.socket) this.socket.close();
    }
}

async function listTargets(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error(`/json/list 返回 ${response.status}`);
    return response.json();
}

async function pageTarget(port, match) {
    const targets = await listTargets(port);
    const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (match) {
        const hit = pages.find((target) => target.url.includes(match));
        if (!hit) {
            const seen = pages.map((target) => target.url).join(", ");
            throw new Error(`没有匹配 "${match}" 的页面目标，现有目标: ${seen || "(空)"}`);
        }
        return hit;
    }
    const main = pages.find((target) => {
        try {
            return new URL(target.url).pathname === "/";
        } catch {
            return false;
        }
    });
    const page = main ?? pages[0];
    if (!page) {
        const seen = targets.map((target) => `${target.type}:${target.url}`).join(", ");
        throw new Error(`没有可驱动的页面目标，现有目标: ${seen || "(空)"}`);
    }
    return page;
}

module.exports = { CdpClient, listTargets, pageTarget };
