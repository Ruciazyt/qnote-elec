const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { resolveExe } = require('../lib/resolve-exe');


const APP_ENTRY = 'dist/main/index.js';
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DRY_RUN = process.argv.includes('--dry-run');

const POWERSHELL = resolveExe('powershell.exe');
const TASKKILL = resolveExe('taskkill');
const PS = resolveExe('ps');
const PKILL = resolveExe('pkill');

const PROCESS_PATTERNS = [
    {
        label: 'concurrently',
        exe: 'node.exe',
        markers: ['concurrently', PROJECT_ROOT],
    },
    {
        label: 'Electron',
        exe: 'electron.exe',
        markers: [APP_ENTRY, PROJECT_ROOT],
    },
    {
        label: 'vite',
        exe: 'node.exe',
        markers: ['renderer', 'vite', PROJECT_ROOT],
    },
    {
        label: 'tsc',
        exe: 'node.exe',
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

function listPids(pattern) {
    return process.platform === 'win32' ? listWindowsPids(pattern) : listPosixPids(pattern);
}

function killPid(pid) {
    if (process.platform === 'win32') {
        execFileSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    try {
        execFileSync(PKILL, ['-P', String(pid), '-9'], { stdio: 'ignore' });
    } catch {
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
    }
}

function main() {
    const targets = [];
    const seen = new Set();
    for (const pattern of PROCESS_PATTERNS) {
        try {
            for (const pid of listPids(pattern)) {
                if (seen.has(pid)) continue;
                seen.add(pid);
                targets.push({ pid, label: pattern.label });
            }
        } catch (err) {
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
