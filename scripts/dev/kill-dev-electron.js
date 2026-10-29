const { execFileSync } = require('child_process');
const path = require('path');
const { resolveExe } = require('../lib/resolve-exe');

/**
 * 启动 dev 之前清理残留的 Electron 实例（以及会跟它抢端口的 vite / tsc）。
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
 * ## 为什么还要清 vite / tsc
 *
 * 孤儿 electron 只是表象，真正让用户看到白屏的是**孤儿 vite**。
 *
 * 主进程里的 DEV_SERVER_URL 是写死的 http://localhost:5173（mainWindow /
 * clipboardPopup / stickyNote 三处）。vite 默认在端口被占时会静默往下找一个
 * 空端口（5174、5175……），而主进程仍然去连 5173 —— 连上的是上一次遗留的
 * 旧 vite 实例，页面跟当前源码对不上。
 *
 * 更糟的是旧实例上的 electron-reloader 一直在监听 dist/main：tsc 一重编译
 * 它就 relaunch，把当前实例的窗口一起销毁，主窗口和圆形控件同时报
 * ERR_FAILED (-2)。
 *
 * vite.config.ts 里的 strictPort: true 只能让"端口被占"在启动时立刻暴露，
 * 解决不了"端口已经被自己上一次的残留占着"这个根因 —— 所以这里必须把
 * 本项目的 vite / tsc / concurrently 一起清掉。
 *
 * ## 匹配条件
 *
 * 每个条件组都要求命令行含本项目绝对路径 —— 别的项目自带的 vite / tsc
 * 不会带这个：
 *   1. electron：含 `dist/main/index.js`（打包版 QNote.exe 不会带这个）
 *   2. vite：含 `src/renderer` 且含 `vite`
 *   3. tsc：含 `typescript\bin\tsc` 且含 `build/tsconfig.main.json`
 *   4. concurrently：含 `concurrently` 且含本项目路径
 *
 * 用法：node scripts/dev/kill-dev-electron.js [--dry-run]
 */

const APP_ENTRY = 'dist/main/index.js';
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DRY_RUN = process.argv.includes('--dry-run');

// 命令解析成绝对路径再执行 —— 靠 PATH 查找的命令可以被同名可执行文件劫持，
// SonarCloud 会把这记成 S4036 安全漏洞（质量门禁里 Security Rating 直接掉到 E）。
const POWERSHELL = resolveExe('powershell.exe');
const TASKKILL = resolveExe('taskkill');
const PS = resolveExe('ps');
const PKILL = resolveExe('pkill');

/**
 * 要清理的进程类型
 *
 * 每种给出「命令行必须同时满足的两个条件」。两个条件缺一不可，
 * 宁可漏杀也不能误杀 —— 别的项目的 vite / tsc / electron 不该被牵连。
 */
const PROCESS_PATTERNS = [
    {
        // concurrently 要排在最前面 —— 它的命令行里含 "vite" 和 "renderer"
        // （-n "tsc,vite,app" ... "pnpm run dev:renderer"），会被后面的规则先命中。
        label: 'concurrently',
        exe: 'node.exe',
        // dev 会话的父进程，带上它才能整棵子树一起收掉
        markers: ['concurrently', PROJECT_ROOT],
    },
    {
        label: 'Electron',
        exe: 'electron.exe',
        // 打包版 QNote.exe 不会带 dist/main/index.js
        markers: [APP_ENTRY, PROJECT_ROOT],
    },
    {
        label: 'vite',
        exe: 'node.exe',
        // 本项目的 vite 在 src/renderer 下。
        // 两个细节：
        //  1. 只匹配 'renderer' 而不是 'src/renderer' —— 命令行里是反斜杠
        //     （...\src\renderer\node_modules\...），写正斜杠永远匹配不上；
        //  2. 同时要求含本项目路径，否则别的项目里带 renderer 字样的 vite 会被误杀。
        markers: ['renderer', 'vite', PROJECT_ROOT],
    },
    {
        label: 'tsc',
        exe: 'node.exe',
        // 本项目的 tsc watch 编译主进程
        markers: ['typescript', 'build/tsconfig.main.json'],
    },
];

function listWindowsPids(pattern) {
    const conditions = pattern.markers
        .map(marker => `$_.CommandLine -like '*${marker.replace(/'/g, "''")}*'`)
        .join(' -and ');
    const psCmd = [
        `Get-CimInstance Win32_Process -Filter "Name='${pattern.exe}'"`,
        `| Where-Object { ${conditions} }`,
        `| ForEach-Object { $_.ProcessId }`,
    ].join(' ');

    const out = execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        encoding: 'utf8',
    });

    return out
        .split(/\r?\n/)
        .map(line => Number(line.trim()))
        .filter(pid => Number.isInteger(pid) && pid > 0);
}

function listPosixPids(pattern) {
    const out = execFileSync(PS, ['-eo', 'pid=,args='], { encoding: 'utf8' });

    return out
        .split('\n')
        .map(line => {
            // \S.* 而不是 .* —— \s+ 与 .* 字符集重叠，引擎会在每个空白分隔点重试，
            // 退化成 O(n²) 回溯（SonarCloud S8786）。
            const matched = line.trim().match(/^(\d+)\s+(\S.*)$/);
            return matched ? { pid: Number(matched[1]), cmd: matched[2] } : null;
        })
        .filter(Boolean)
        .filter(
            entry =>
                entry.pid !== process.pid &&
                !entry.cmd.includes('kill-dev-electron') &&
                pattern.markers.every(marker => entry.cmd.includes(marker))
        )
        .map(entry => entry.pid);
}

/** 按类型枚举 PID（跨平台） */
function listPids(pattern) {
    return process.platform === 'win32' ? listWindowsPids(pattern) : listPosixPids(pattern);
}

function killPid(pid) {
    if (process.platform === 'win32') {
        // /T 连同渲染进程、GPU 进程一起杀，否则主进程没了子进程还挂着
        execFileSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    // SIGKILL 主进程不会带走子进程，先子后父
    try {
        execFileSync(PKILL, ['-P', String(pid), '-9'], { stdio: 'ignore' });
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
    let targets = [];
    const seen = new Set();
    for (const pattern of PROCESS_PATTERNS) {
        try {
            for (const pid of listPids(pattern)) {
                // 同一个进程可能命中多类（concurrently 的命令行里就含 "vite"），
                // 只清一次 —— 重复 taskkill 会让后面的清理报"进程已不存在"。
                if (seen.has(pid)) continue;
                seen.add(pid);
                targets.push({ pid, label: pattern.label });
            }
        } catch (err) {
            // 枚举失败绝不能挡住 dev 启动 —— 那比多几个实例更麻烦
            console.warn(`⚠️  枚举残留 ${pattern.label} 进程失败，跳过清理: ${err.message}`);
        }
    }

    if (targets.length === 0) {
        console.log('🧹 未发现残留的 dev 进程');
        return;
    }

    for (const { pid, label } of targets) {
        if (DRY_RUN) {
            console.log(`🔍 [dry-run] 将清理残留 ${label} 进程 PID=${pid}`);
            continue;
        }
        try {
            killPid(pid);
            console.log(`🧹 已清理残留 ${label} 进程 PID=${pid}`);
        } catch (err) {
            console.warn(`⚠️  清理 ${label} PID=${pid} 失败: ${err.message}`);
        }
    }
}

main();
