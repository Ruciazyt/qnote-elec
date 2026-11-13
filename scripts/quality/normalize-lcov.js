#!/usr/bin/env node
'use strict';

/**
 * 把 vitest 产出的 lcov 路径改写成 SonarCloud 能认的形式
 *
 * vitest 的根目录是 src/renderer，所以 lcov 里的 SF 行长这样：
 *
 *   SF:App.tsx
 *   SF:components\Leetcode\Collection.tsx      （Windows 上是反斜杠）
 *
 * SonarCloud 的 LCOV 解析器要的是**相对仓库根目录**、**正斜杠**的路径。
 * 直接把这份文件喂给它，它会去找 <仓库根>/App.tsx —— 找不到，
 * 覆盖率就整体算成 0。
 *
 * 所以这里把每条 SF 前面补上 src/renderer/，并把反斜杠换成正斜杠。
 *
 * 用法：node scripts/quality/normalize-lcov.js [文件路径]
 * 默认处理 src/renderer/coverage/lcov.info
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_FILE = path.join(ROOT, 'src', 'renderer', 'coverage', 'lcov.info');

/** vitest 根目录相对仓库根的位置 */
const RENDERER_PREFIX = 'src/renderer';

function normalizeRecord(record) {
    return record.replace(/^SF:(.+)$/, (line, filePath) => {
        const normalized = filePath.replace(/\\/g, '/');
        // 绝对路径不动（有的工具会写绝对路径）
        if (path.isAbsolute(filePath) || /^[A-Za-z]:/.test(normalized)) {
            return `SF:${normalized}`;
        }
        // 已经带 src/ 前缀的（多根目录场景）不动
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
