#!/usr/bin/env node
'use strict';


const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_FILE = path.join(ROOT, 'src', 'renderer', 'coverage', 'lcov.info');

const RENDERER_PREFIX = 'src/renderer';

const REPO_ROOTS = ['src', 'scripts'];

const SRC_DIRS = {
    main: 'src/main',
    shared: 'src/shared',
    database: 'src/database',
    renderer: RENDERER_PREFIX,
};

function resolveSegments(value) {
    const absolute = value.startsWith('/');
    const out = [];
    for (const segment of value.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            out.pop();
            continue;
        }
        out.push(segment);
    }
    return (absolute ? '/' : '') + out.join('/');
}

function toRepoPath(normalized) {
    const resolved = resolveSegments(normalized);
    if (REPO_ROOTS.some((root) => resolved === root || resolved.startsWith(root + '/'))) {
        return resolved;
    }
    const head = resolved.split('/')[0];
    if (SRC_DIRS[head]) {
        return SRC_DIRS[head] + resolved.slice(head.length);
    }
    return RENDERER_PREFIX + '/' + resolved;
}

function normalizeRecord(record) {
    return record.replace(/^SF:(.+)$/, (line, filePath) => {
        const normalized = filePath.replace(/\\/g, '/');
        if (path.isAbsolute(filePath) || /^[A-Za-z]:/.test(normalized)) {
            return 'SF:' + resolveSegments(normalized);
        }
        return 'SF:' + toRepoPath(normalized);
    });
}

function main() {
    const target = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_FILE;

    if (!fs.existsSync(target)) {
        console.error('❌ 找不到 lcov 文件：' + target);
        console.error('   先跑 `pnpm run test:coverage` 生成覆盖率报告。');
        process.exit(1);
    }

    const original = fs.readFileSync(target, 'utf8');
    const lines = original.split('\n');
    const updated = lines.map(normalizeRecord).join('\n');

    if (updated === original) {
        console.log('✅ lcov 路径已经是规范形式：' + path.relative(ROOT, target));
        return;
    }

    fs.writeFileSync(target, updated, 'utf8');

    const count = lines.filter((line) => line.startsWith('SF:')).length;
    console.log('✅ 已归一化 ' + count + ' 条 SF 路径：' + path.relative(ROOT, target));
}

main();
