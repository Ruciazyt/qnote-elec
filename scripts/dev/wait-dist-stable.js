const fs = require('fs');
const os = require('os');
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
 * 用法：node scripts/wait-dist-stable.js [安静窗口毫秒] [超时毫秒] [基准时间戳毫秒]
 *
 * 基准时间戳：只有晚于它的写入才算「本轮的」。由 dev 脚本在 build:electron
 * 之后立即取当前时间传进来 —— build:electron 是本轮的第一批产物，tsc -w 的
 * 首轮全量 emit 必然晚于它。不传则退化为「晚于本脚本启动时刻」。
 */

// 注意是 '../..' 不是 '..' —— __dirname 是 scripts/dev/，
// 少一级就会指向 scripts/dist（不存在），脚本会直接跳过等待，
// tsc 首轮重写与 Electron 启动的竞态就再也挡不住了。
const DIST_DIR = path.resolve(__dirname, '..', '..', 'dist');
const BASELINE_FILE = path.join(os.tmpdir(), 'qnote-dist-baseline.json');
const QUIET_MS = Number(process.argv[2]) || 2000;
const TIMEOUT_MS = Number(process.argv[3]) || 120000;
const POLL_MS = 150;
const WATCHED = /\.(js|cjs|mjs|map)$/i;

/**
 * 读 build:electron 之后记录的基准时刻
 *
 * 命令行参数优先；没有参数就读 stamp-baseline.js 写的基准文件；
 * 都没有则返回 0 —— 此时退化为「晚于本脚本启动时刻」。
 */
function readBaseline() {
    const fromArg = Number(process.argv[4]);
    if (fromArg > 0) return fromArg;

    try {
        const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
        const value = Number(raw.baseline);
        return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
        return 0;
    }
}

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

    // 「本轮写入」的基准时刻。优先用外部传入的基准（build:electron 完成时刻），
    // 没传就用脚本自己的启动时刻。
    const baseline = readBaseline() || startedAt;

    // 只认「晚于本脚本启动时刻」的写入。
    //
    // 原来的实现把 lastSeen 初始化成 newestMtime(现有 dist) —— 那是**上一轮**
    // 构建留下的时间戳。于是 tsc 还在做首轮类型检查（实测约 11 秒，这期间
    // 一个文件都没写）时，dist 的 mtime 纹丝不动，安静窗口从脚本启动那刻
    // 就算满了，脚本立刻放行 Electron。
    //
    // 放行之后 tsc 才批量重写 dist/main，electron-reloader 监听到变更 →
    // app.relaunch() + app.exit(0) → 刚起来的窗口被销毁 → 正在进行的页面
    // 加载被中止 → 主窗口报 ERR_FAILED (-2)。
    //
    // 所以必须先确认「本轮确实写过了」，才谈得上「安静」。改动前的 mtime
    // 一律不算数 —— 它们属于上一次构建。
    let lastSeen = 0;
    let lastChangedAt = startedAt;
    let sawFreshWrite = false;

    while (Date.now() - startedAt < TIMEOUT_MS) {
        await sleep(POLL_MS);

        const current = newestMtime(DIST_DIR);

        // 只有晚于基准时刻的写入才算「本轮的」
        if (current > baseline) {
            if (!sawFreshWrite) {
                sawFreshWrite = true;
                console.log('⏳ 检测到本轮编译产物写入，等待写盘稳定...');
            }
            if (current !== lastSeen) {
                lastSeen = current;
                lastChangedAt = Date.now();
                continue;
            }
        }

        // 必须先看到本轮写入，再等安静窗口
        if (sawFreshWrite && Date.now() - lastChangedAt >= QUIET_MS) {
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
