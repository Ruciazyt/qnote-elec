const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { CdpClient, listTargets, pageTarget } = require("./cdp");
const { resolveExe } = require("../../lib/resolve-exe");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_PORT = 9333;
const RENDERER_PORT = 5173;
let TARGET_MATCH = undefined;

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token.startsWith("--")) {
            const key = token.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith("--")) {
                args[key] = true;
            } else {
                args[key] = next;
                i += 1;
            }
        } else {
            args._.push(token);
        }
    }
    return args;
}

function sessionPath(port) {
    return path.join(os.tmpdir(), `qnote-verify-${port}.json`);
}

function readSession(port) {
    const file = sessionPath(port);
    if (!fs.existsSync(file)) {
        throw new Error(`没有端口 ${port} 的验证会话，先跑 launch：node scripts/dev/verify/qnote-verify.js launch --port ${port}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function portOf(args) {
    return Number(args.port ?? DEFAULT_PORT);
}

function portOpen(port) {
    const hosts = ["127.0.0.1", "::1"];
    return Promise.all(
        hosts.map(
            (host) =>
                new Promise((resolve) => {
                    const socket = net.connect({ host, port }, () => {
                        socket.destroy();
                        resolve(true);
                    });
                    socket.on("error", () => resolve(false));
                    socket.setTimeout(1500, () => {
                        socket.destroy();
                        resolve(false);
                    });
                })
        )
    ).then((results) => results.some(Boolean));
}

function waitForPort(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return (async () => {
        while (Date.now() < deadline) {
            if (await portOpen(port)) return true;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return false;
    })();
}

function linkDir(target, linkPath) {
    if (fs.existsSync(linkPath)) {
        throw new Error(`${linkPath} 已存在，先清掉再跑 launch`);
    }
    fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function electronBinary() {
    const entry = path.join(REPO_ROOT, "node_modules", "electron");
    const resolved = require(entry);
    return typeof resolved === "string" ? resolved : resolved.default;
}

function killTree(pid) {
    if (!pid) return;
    if (process.platform === "win32") {
        spawnSync(resolveExe("taskkill"), ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        return;
    }
    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
        }
    }
}

async function launch(args) {
    const port = portOf(args);
    const mainEntry = path.join(REPO_ROOT, "dist", "main", "index.js");
    if (!fs.existsSync(mainEntry)) {
        throw new Error("dist/main/index.js 不存在，先跑 pnpm run build:electron");
    }
    if (fs.existsSync(sessionPath(port))) {
        const existing = readSession(port);
        if (await portOpen(port)) {
            throw new Error(`端口 ${port} 上已有验证会话在跑，先 stop：node scripts/dev/verify/qnote-verify.js stop --port ${port}`);
        }
        killTree(existing.electronPid);
    }

    let rendererPid = null;
    if (!(await portOpen(RENDERER_PORT))) {
        const logFile = path.join(os.tmpdir(), `qnote-verify-renderer-${port}.log`);
        const out = fs.openSync(logFile, "a");
        const renderer = spawn(
            resolveExe("pnpm"),
            ["--dir", path.join(REPO_ROOT, "src", "renderer"), "run", "dev"],
            { cwd: REPO_ROOT, detached: true, stdio: ["ignore", out, out], shell: process.platform === "win32" }
        );
        rendererPid = renderer.pid;
        renderer.unref();
        const ready = await waitForPort(RENDERER_PORT, 60000);
        if (!ready) {
            killTree(rendererPid);
            throw new Error(`渲染层 dev server 没起来，看 ${logFile}`);
        }
    }

    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const runRoot = path.join(REPO_ROOT, ".data", "verify", runId);
    const evidenceDir = path.join(runRoot, "evidence");
    const appRoot = args.root ? path.resolve(args.root) : path.join(runRoot, "tree");
    fs.mkdirSync(appRoot, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, "dist"), path.join(appRoot, "app"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(appRoot, "package.json"));
    linkDir(path.join(REPO_ROOT, "node_modules"), path.join(appRoot, "node_modules"));
    linkDir(path.join(REPO_ROOT, "resources"), path.join(appRoot, "resources"));
    const userData = path.join(appRoot, "udata");
    fs.mkdirSync(userData, { recursive: true });

    const appLog = path.join(appRoot, "app.log");
    const logFd = fs.openSync(appLog, "a");
    const child = spawn(
        electronBinary(),
        [path.join(appRoot, "app", "main", "index.js"), `--user-data-dir=${userData}`],
        {
            cwd: appRoot,
            detached: true,
            stdio: ["ignore", logFd, logFd],
            env: { ...process.env, QNOTE_REMOTE_DEBUG_PORT: String(port) },
        }
    );

    const cdpReady = await waitForPort(port, 30000);
    if (!cdpReady) {
        killTree(child.pid);
        throw new Error(`CDP 端口 ${port} 没起来，看 ${appLog}`);
    }

    child.unref();

    const pageTargetInfo = await waitForPageTarget(port, 30000);
    if (!pageTargetInfo) {
        killTree(child.pid);
        throw new Error(`主窗口没有出现，看 ${appLog}`);
    }

    const session = {
        port,
        runId,
        electronPid: child.pid,
        rendererPid,
        appRoot,
        tempRoot: appRoot,
        userData,
        evidenceDir,
        appLog,
        repoRoot: REPO_ROOT,
        startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(sessionPath(port), JSON.stringify(session, null, 2));
    process.stdout.write(JSON.stringify(session, null, 2) + "\n");
}

function stop(args) {
    const port = portOf(args);
    const file = sessionPath(port);
    if (!fs.existsSync(file)) {
        process.stdout.write(`端口 ${port} 没有验证会话\n`);
        return;
    }
    const session = JSON.parse(fs.readFileSync(file, "utf8"));
    killTree(session.electronPid);
    if (session.rendererPid) killTree(session.rendererPid);
    session.stoppedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(session, null, 2));
    process.stdout.write(
        JSON.stringify(
            {
                stopped: true,
                evidenceDir: session.evidenceDir,
                disposeTempRoot: session.tempRoot,
                note: "临时目录留给调用方处置，验证脚本不做删除",
            },
            null,
            2
        ) + "\n"
    );
}

async function parkWindow(port) {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    let page = null;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        const targets = await listTargets(port);
        page = targets.find((target) => target.type === "page");
        if (page) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!page) return { parked: false, reason: "没有页面目标" };
    const client = await new CdpClient(version.webSocketDebuggerUrl).connect();
    try {
        const window = await client.send("Browser.getWindowForTarget", { targetId: page.id });
        await client.send("Browser.setWindowBounds", {
            windowId: window.windowId,
            bounds: { left: -30000, top: -30000, width: 1280, height: 800, windowState: "normal" },
        });
        return { parked: true, windowId: window.windowId };
    } finally {
        client.close();
    }
}

async function waitForPageTarget(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const targets = await listTargets(port);
        const main = targets.find((target) => {
            if (target.type !== "page") return false;
            try {
                return new URL(target.url).pathname === "/";
            } catch {
                return false;
            }
        });
        if (main) return main;
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return null;
}

async function withClient(port, fn, match) {
    const target = await pageTarget(port, match ?? TARGET_MATCH);
    const client = await new CdpClient(target.webSocketDebuggerUrl).connect();
    try {
        return await fn(client, target);
    } finally {
        client.close();
    }
}

async function evaluate(client, expression) {
    const result = await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (result.exceptionDetails) {
        const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
        throw new Error(`页面脚本异常: ${text}`);
    }
    return result.result?.value;
}

const MATCH_JS = `(el, spec) => {
    if (spec.aria !== undefined) return el.getAttribute("aria-label") === spec.aria;
    if (spec.placeholder !== undefined) return el.getAttribute("placeholder") === spec.placeholder;
    if (spec.role !== undefined) {
        const role = el.getAttribute("role");
        return role === spec.role || el.tagName.toLowerCase() === spec.role;
    }
    if (spec.text !== undefined) return (el.textContent || "").trim() === spec.text;
    return false;
}`;

const RESOLVE_JS = `(spec, match) => {
    const all = [...document.querySelectorAll(spec.css || "*")];
    const matches = all.filter((el) => match(el, spec));
    const visible = matches.filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
    });
    const score = (el) => {
        const rect = el.getBoundingClientRect();
        const interactive = el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT" || el.getAttribute("role") === "button";
        return interactive ? 0 : 1;
    };
    visible.sort((a, b) => score(a) - score(b) || a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    const el = visible[0];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
        tag: el.tagName,
        text: (el.textContent || "").trim().slice(0, 120),
        aria: el.getAttribute("aria-label"),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
    };
}`;

function specFrom(args) {
    const spec = {};
    if (args.aria) spec.aria = args.aria;
    if (args.placeholder) spec.placeholder = args.placeholder;
    if (args.role) spec.role = args.role;
    if (args.text) spec.text = args.text;
    if (args.selector) spec.css = args.selector;
    if (spec.aria === undefined && spec.placeholder === undefined && spec.role === undefined && spec.text === undefined) {
        spec.css = args.selector ?? "*";
    }
    return spec;
}

async function locate(client, args) {
    const spec = specFrom(args);
    const found = await evaluate(
        client,
        `(${RESOLVE_JS})(${JSON.stringify(spec)}, (${MATCH_JS}))`
    );
    if (!found) {
        const wanted = JSON.stringify(spec);
        throw new Error(`找不到元素 ${wanted}`);
    }
    return found;
}

async function click(args) {
    const port = portOf(args);
    await withClient(port, async (client) => {
        await locate(client, args);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const element = await locate(client, args);
        const button = args.right ? "right" : "left";
        const base = { x: element.x, y: element.y, button, clickCount: 1 };
        await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: element.x, y: element.y });
        await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
        await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
        process.stdout.write(JSON.stringify({ clicked: element, button }, null, 2) + "\n");
    });
}

async function fill(args) {
    const port = portOf(args);
    const value = args.value ?? "";
    await withClient(port, async (client) => {
        const element = await locate(client, args);
        await evaluate(client, `(() => {
            const spec = ${JSON.stringify(specFrom(args))};
            const match = (${MATCH_JS});
            const all = [...document.querySelectorAll(spec.css || "*")];
            const hit = all.find((el) => match(el, spec));
            if (!hit) return false;
            hit.focus();
            if (typeof hit.select === "function") hit.select();
            return true;
        })()`);
        await client.send("Input.insertText", { text: value });
        process.stdout.write(JSON.stringify({ filled: element, value }, null, 2) + "\n");
    });
}

async function press(args) {
    const port = portOf(args);
    const key = args.key ?? "Enter";
    const modifiers =
        (args.ctrl ? 2 : 0) + (args.shift ? 8 : 0) + (args.alt ? 1 : 0) + (args.meta ? 4 : 0);
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const text = key.length === 1 ? key : undefined;
    await withClient(port, async (client) => {
        await client.send("Input.dispatchKeyEvent", {
            type: text ? "keyDown" : "rawKeyDown",
            key,
            code,
            windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
            text,
            modifiers,
        });
        await client.send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key,
            code,
            windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
            modifiers,
        });
        process.stdout.write(JSON.stringify({ pressed: key, modifiers }, null, 2) + "\n");
    });
}

async function nav(args) {
    const port = portOf(args);
    const route = args.route ?? "/";
    await withClient(port, async (client) => {
        await evaluate(client, `(() => { location.hash = ${JSON.stringify("#" + route)}; return location.hash; })()`);
        await new Promise((resolve) => setTimeout(resolve, 600));
        const path = await evaluate(client, "location.hash");
        process.stdout.write(JSON.stringify({ route: path }, null, 2) + "\n");
    });
}

async function evalCommand(args) {
    const port = portOf(args);
    const expression = args.expr;
    if (!expression) throw new Error("缺少 --expr");
    await withClient(port, async (client) => {
        const value = await evaluate(client, expression);
        process.stdout.write(JSON.stringify(value === undefined ? null : value, null, 2) + "\n");
    });
}

async function waitCommand(args) {
    const port = portOf(args);
    const expression = args.expr;
    const timeout = Number(args.timeout ?? 15000);
    if (!expression) throw new Error("缺少 --expr");
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
        last = await withClient(port, (client) => evaluate(client, expression));
        if (last) {
            process.stdout.write(JSON.stringify({ ok: true, value: last }, null, 2) + "\n");
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    process.stdout.write(JSON.stringify({ ok: false, timeout, last }, null, 2) + "\n");
    process.exitCode = 1;
}

async function shot(args) {
    const port = portOf(args);
    const session = readSession(port);
    const out = args.out
        ? path.isAbsolute(args.out)
            ? args.out
            : path.join(session.evidenceDir, args.out)
        : path.join(session.evidenceDir, "screenshot.png");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await withClient(port, async (client) => {
        await client.send("Page.enable");
        let result = null;
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                result = await client.send("Page.captureScreenshot", { format: "png" }, 30000);
                break;
            } catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        }
        if (!result) throw lastError;
        fs.writeFileSync(out, Buffer.from(result.data, "base64"));
        process.stdout.write(JSON.stringify({ screenshot: out, bytes: fs.statSync(out).size }, null, 2) + "\n");
    });
}

async function doctor(args) {
    const port = portOf(args);
    const report = { port, ok: false };
    try {
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        report.browser = version.Browser;
        const targets = await listTargets(port);
        report.targets = targets.map((target) => ({ type: target.type, url: target.url }));
        const page = targets.find((target) => target.type === "page");
        if (page) {
            report.url = page.url;
            const deadline = Date.now() + 20000;
            let ready = null;
            while (Date.now() < deadline) {
                ready = await withClient(port, (client) =>
                    evaluate(client, "({ ready: document.readyState, hasRoot: !!document.querySelector('#root')?.children.length, hash: location.hash })")
                );
                if (ready?.ready === "complete" && ready?.hasRoot === true) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            report.page = ready;
            report.ok = ready?.ready === "complete" && ready?.hasRoot === true;
        }
    } catch (error) {
        report.error = error.message;
    }
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.ok) process.exitCode = 1;
}

function db(args) {
    const port = portOf(args);
    const session = readSession(port);
    const dbPath = path.join(session.appRoot, ".data", "clipboard.sqlite");
    if (!fs.existsSync(dbPath)) {
        throw new Error(`找不到隔离库 ${dbPath}`);
    }
    let DatabaseSync;
    try {
        ({ DatabaseSync } = require("node:sqlite"));
    } catch {
        throw new Error("当前 Node 不带 node:sqlite，换用 Node 22.5+ 或手动查库");
    }
    const sql = args.sql ?? "select name from sqlite_master where type='table'";
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(sql).all();
    db.close();
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    TARGET_MATCH = args.target ? String(args.target) : undefined;
    const command = args._[0];
    switch (command) {
        case "launch":
            await launch(args);
            break;
        case "stop":
            stop(args);
            break;
        case "doctor":
            await doctor(args);
            break;
        case "nav":
            await nav(args);
            break;
        case "eval":
            await evalCommand(args);
            break;
        case "click":
            await click(args);
            break;
        case "fill":
            await fill(args);
            break;
        case "press":
            await press(args);
            break;
        case "wait":
            await waitCommand(args);
            break;
        case "shot":
            await shot(args);
            break;
        case "db":
            db(args);
            break;
        default:
            process.stderr.write(
                [
                    "用法: node scripts/dev/verify/qnote-verify.js <命令> [选项]",
                    "",
                    "  launch                 启动隔离实例（复制 dist 到临时目录，node_modules/resources 用链接）",
                    "  stop                   结束实例并清理临时目录，保留证据",
                    "  doctor                  体检：进程、CDP、页面是否可用",
                    "  nav --route /todos       切换路由（HashRouter）",
                    "  eval --expr '<js>'       在页面里跑一段 JS 并打印结果",
                    "  wait --expr '<js>'       轮询直到表达式为真",
                    "  click --aria|role|text|selector   真实鼠标点击",
                    "  fill  --selector|aria --value <文本> 聚焦后真实输入",
                    "  press --key Enter [--ctrl] [--shift]  真实按键",
                    "  shot --out <path.png>     截图",
                    "  db --sql '<select>'      只读查隔离库",
                    "",
                    `公共选项: --port <端口>（默认 ${DEFAULT_PORT}）`,
                ].join("\n") + "\n"
            );
            process.exitCode = 1;
    }
}

main()
    .then(() => {
        setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
    })
    .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
        setTimeout(() => process.exit(1), 50).unref();
    });
