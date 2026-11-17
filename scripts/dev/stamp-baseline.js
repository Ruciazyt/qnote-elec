const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');


const BASELINE_FILE = path.join(os.tmpdir(), 'qnote-dist-baseline.json');

function main() {
    const baseline = Date.now();
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ baseline }), 'utf8');
    console.log(`🕐 已记录本轮构建基准时刻 ${baseline}`);
}

main();
