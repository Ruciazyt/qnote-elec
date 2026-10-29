const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 记录本轮构建的基准时刻，供 wait-dist-stable.js 判断「哪些写入属于本轮」。
 *
 * ## 为什么需要这一步
 *
 * `pnpm dev` 的顺序是：build:electron（写一次 dist）→ concurrently 起
 * tsc -w / vite / electron。而 tsc -w 首轮会**全量重新 emit** 一遍 dist/main，
 * 也就是说 build:electron 写出的那批产物，几秒后会被 tsc 首轮再写一遍。
 *
 * wait-dist-stable.js 需要区分「上一轮留下的 mtime」和「本轮 tsc 写的 mtime」，
 * 否则会在 tsc 一个字都还没写的时候误判 dist 已稳定、放行 Electron，
 * 紧接着 tsc 批量重写 → reloader 重启 → 主窗口 ERR_FAILED (-2)。
 *
 * 这个脚本在 build:electron 之后立刻取当前时间写进基准文件，
 * wait-dist-stable.js 再读它。tsc 首轮 emit 必然晚于这个时刻。
 *
 * 基准文件放在系统临时目录 —— 它是每次 dev 的临时状态，不该进仓库。
 */

const BASELINE_FILE = path.join(os.tmpdir(), 'qnote-dist-baseline.json');

function main() {
    const baseline = Date.now();
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ baseline }), 'utf8');
    console.log(`🕐 已记录本轮构建基准时刻 ${baseline}`);
}

main();
