#!/usr/bin/env node
'use strict';


const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_FILE = path.join(ROOT, 'src', 'renderer', 'coverage', 'lcov.info');

const RENDERER_PREFIX = 'src/renderer';

function normalizeRecord(record) {
    return record.replace(/^SF:(.+)$/, (line, filePath) => {
        const normalized = filePath.replace(/\\/g, '/');
        if (path.isAbsolute(filePath) || /^[A-Za-z]:/.test(normalized)) {
            return `SF:${normalized}`;
        }
        if (normalized.startsWith('src/')) {
            return `SF:${normalized}`;
        }
        return `SF:${RENDERER_PREFIX}/${normalized}`;
    });
}

function main() {
    const target = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_FILE;

    if (!fs.existsSync(target)) {
        console.error(`❌ 找不到 lcov 文件：${target}`);
        console.error('   先跑 `pnpm run test:coverage` 生成覆盖率报告。');
        process.exit(1);
    }

    const original = fs.readFileSync(target, 'utf8');
    const lines = original.split('\n');
    const updated = lines.map(normalizeRecord).join('\n');

    if (updated === original) {
        console.log(`✅ lcov 路径已经是规范形式：${path.relative(ROOT, target)}`);
        return;
    }

    fs.writeFileSync(target, updated, 'utf8');

    const count = lines.filter((line) => line.startsWith('SF:')).length;
    console.log(`✅ 已归一化 ${count} 条 SF 路径：${path.relative(ROOT, target)}`);
}

main();
