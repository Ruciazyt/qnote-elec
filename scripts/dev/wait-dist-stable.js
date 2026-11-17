const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');


const DIST_DIR = path.resolve(__dirname, '..', '..', 'dist');
const BASELINE_FILE = path.join(os.tmpdir(), 'qnote-dist-baseline.json');
const QUIET_MS = Number(process.argv[2]) || 2000;
const TIMEOUT_MS = Number(process.argv[3]) || 120000;
const POLL_MS = 150;
const WATCHED = /\.(js|cjs|mjs|map)$/i;

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

    const baseline = readBaseline() || startedAt;

    let lastSeen = 0;
    let lastChangedAt = startedAt;
    let sawFreshWrite = false;

    while (Date.now() - startedAt < TIMEOUT_MS) {
        await sleep(POLL_MS);

        const current = newestMtime(DIST_DIR);

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

        if (sawFreshWrite && Date.now() - lastChangedAt >= QUIET_MS) {
            const waited = ((Date.now() - startedAt) / 1000).toFixed(1);
            console.log(`⏳ dist 已稳定 ${QUIET_MS}ms（等待 ${waited}s），启动 Electron`);
            return;
        }
    }

    console.warn(`⚠️  等待 dist 稳定超过 ${TIMEOUT_MS}ms，继续启动 Electron`);
}

void main();
