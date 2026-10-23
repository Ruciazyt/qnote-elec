const fs = require('fs');
const path = require('path');

/**
 * 等 dist 目录写盘稳定下来，再启动 Electron。
 *
 * ## 为什么需要这一步
 *
 * dev 脚本里 tsc 以 `-w`（watch）模式运行，而 **TypeScript 的 watch 模式首次
 * 构建会全量重新 emit**：实测一次 pnpm dev，dist 下 82 个编译产物的 mtime
 * 全部被改写成同一个时刻（tsc 报 "Found 0 errors" 的那一秒），而不是提前跑
 * 一次 `build:electron` 的时间。也就是说 `build:electron` 挡不住它 —— 产物
 * 照样会在 Electron 起来之后被重写一遍。
 *
 * 而 electron-reloader 监听的正是这些主进程模块文件。于是每次 pnpm dev 的
 * 必然序列是：
 *   1. wait-on 看到 vite 端口起来了，放行，Electron 启动（11:24:45 左右）
 *   2. tsc -w 首轮把 82 个文件重写（11:24:46）
 *   3. reloader 触发 app.relaunch() + app.exit(0) —— 又重启一次
 *
 * 第 3 步还有副作用：app.exit(0) **不会触发 before-quit**，所以关数据库的
 * 清理代码一行都不跑。此时 sqlite3 的原生操作（打开连接 + 迁移）正在途，
 * 进程在 napi 回调中途被强杀，就会变成 `Error::ThrowAsJavaScriptException
 * napi_throw` → SIGABRT → 退出码 134。也就是"每次启动必看一次红色崩溃栈"。
 * （新实例是被 relaunch 正常拉起来的，功能上不受影响，红字来自正在退出的旧实例。）
 *
 * 这里等 dist 安静下来再启动 Electron，就让"重编译"和"启动"不再撞车，
 * 启动阶段的 relaunch 和随之而来的 134 一起消失。改代码时的热重载不受影响。
 *
 * 用法：node scripts/wait-dist-stable.js [安静窗口毫秒] [超时毫秒]
 */

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const QUIET_MS = Number(process.argv[2]) || 2000;
const TIMEOUT_MS = Number(process.argv[3]) || 120000;
const POLL_MS = 150;
const WATCHED = /\.(js|cjs|mjs|map)$/i;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** dist 下所有编译产物的最新 mtime；目录不存在时返回 0。 */
function newestMtime(dir) {
    let newest = 0;
    const stack = [dir];

    while (stack.length) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (!entry.isFile() || !WATCHED.test(entry.name)) continue;
            try {
                const mtime = fs.statSync(full).mtimeMs;
                if (mtime > newest) newest = mtime;
            } catch {
                // 编译过程中文件可能被替换掉，跳过即可
            }
        }
    }

    return newest;
}

async function main() {
    if (!fs.existsSync(DIST_DIR)) {
        console.log('⏳ 未找到 dist 目录，跳过等待');
        return;
    }

    const startedAt = Date.now();
    let lastSeen = newestMtime(DIST_DIR);
    let lastChangedAt = Date.now();

    while (Date.now() - startedAt < TIMEOUT_MS) {
        await sleep(POLL_MS);

        const current = newestMtime(DIST_DIR);
        if (current !== lastSeen) {
            lastSeen = current;
            lastChangedAt = Date.now();
            continue;
        }

        if (Date.now() - lastChangedAt >= QUIET_MS) {
            const waited = ((Date.now() - startedAt) / 1000).toFixed(1);
            console.log(`⏳ dist 已稳定 ${QUIET_MS}ms（等待 ${waited}s），启动 Electron`);
            return;
        }
    }

    // 超时不能挡住 dev 启动 —— 顶多多一次启动即重启而已
    console.warn(`⚠️  等待 dist 稳定超过 ${TIMEOUT_MS}ms，继续启动 Electron`);
}

// main 内部不会 reject（等待逻辑全在 try/catch 里），显式 void 掉返回值
void main();
