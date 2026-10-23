const { execFileSync } = require('child_process');
const path = require('path');

/**
 * 启动 dev 之前清理残留的 Electron 实例。
 *
 * ## 为什么需要这一步
 *
 * electron-reloader 的热重载是 `app.relaunch() + app.exit(0)`，relaunch 会
 * **再拉起一个完整的应用实例**。而 `concurrently` 故意不加 `-k`（加了会被
 * relaunch 的 app.exit(0) 连带杀掉 tsc 和 vite，整个 dev 会话当场结束），所以
 * Ctrl+C 只能结束 concurrently / tsc / vite —— 被 relaunch 拉起来、已经脱离
 * 进程树（父进程已死）的 electron 实例会活下来。
 *
 * 这些孤儿实例自己也在监听 dist/main，于是下一次 `pnpm dev` 触发一次 tsc 重编译时，
 * 每个孤儿都会各自再拉起一个新实例，数量只增不减。实测一次 pnpm dev 7.5 秒内
 * 连开 5 个实例，之后仍有 3 个主进程存活。
 *
 * src/main/index.ts 里的单实例锁能挡住"同时存在多个"，但挡不住"焦点跳到跑旧代码
 * 的孤儿"—— 新实例会秒退、用户看到的还是上次那份。所以启动前必须先把孤儿清掉。
 *
 * ## 匹配条件
 *
 * 两个条件缺一不可，宁可漏杀也不能误杀：
 *   1. 命令行含 `dist/main/index.js` —— 打包版 QNote.exe 不会带这个；
 *   2. 命令行含本项目绝对路径 —— 别的项目自带的 electron 不会带这个。
 *
 * 用法：node scripts/kill-dev-electron.js [--dry-run]
 */

const APP_ENTRY = 'dist/main/index.js';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

function listWindowsPids() {
    const ps = [
        `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`,
        `| Where-Object { $_.CommandLine -like '*${APP_ENTRY}*' -and $_.CommandLine -like '*${PROJECT_ROOT}*' }`,
        `| ForEach-Object { $_.ProcessId }`,
    ].join(' ');

    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        encoding: 'utf8',
    });

    return out
        .split(/\r?\n/)
        .map(line => Number(line.trim()))
        .filter(pid => Number.isInteger(pid) && pid > 0);
}

function listPosixPids() {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });

    return out
        .split('\n')
        .map(line => {
            const matched = line.trim().match(/^(\d+)\s+(.*)$/);
            return matched ? { pid: Number(matched[1]), cmd: matched[2] } : null;
        })
        .filter(Boolean)
        .filter(
            entry =>
                entry.pid !== process.pid &&
                !entry.cmd.includes('kill-dev-electron') &&
                entry.cmd.includes(APP_ENTRY) &&
                entry.cmd.includes(PROJECT_ROOT)
        )
        .map(entry => entry.pid);
}

function killPid(pid) {
    if (process.platform === 'win32') {
        // /T 连同渲染进程、GPU 进程一起杀，否则主进程没了子进程还挂着
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    // SIGKILL 主进程不会带走子进程，先子后父
    try {
        execFileSync('pkill', ['-P', String(pid), '-9'], { stdio: 'ignore' });
    } catch {
        // 没有子进程
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // 已经自己退出了
    }
}

function main() {
    let pids = [];
    try {
        pids = process.platform === 'win32' ? listWindowsPids() : listPosixPids();
    } catch (err) {
        // 枚举失败绝不能挡住 dev 启动 —— 那比多几个实例更麻烦
        console.warn(`⚠️  枚举残留 Electron 进程失败，跳过清理: ${err.message}`);
        return;
    }

    if (pids.length === 0) {
        console.log('🧹 未发现残留的 dev Electron 实例');
        return;
    }

    for (const pid of pids) {
        if (DRY_RUN) {
            console.log(`🔍 [dry-run] 将清理残留 Electron 实例 PID=${pid}`);
            continue;
        }
        try {
            killPid(pid);
            console.log(`🧹 已清理残留的 dev Electron 实例 PID=${pid}`);
        } catch (err) {
            console.warn(`⚠️  清理 PID=${pid} 失败: ${err.message}`);
        }
    }
}

main();
