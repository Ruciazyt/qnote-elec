#!/usr/bin/env node
'use strict';

/**
 * 本地 SonarJS 扫描 —— 没有令牌时的等效手段
 *
 * SonarCloud 对 JS/TS 用的就是 eslint-plugin-sonarjs 这套规则，
 * 所以本地跑一遍等于把 Sonar 的一部分提前搬到本地：
 * 不用等 CI、不用配令牌，改完立刻能复扫。
 *
 * 用法：
 *   node scripts/quality/local-scan.js          # 出清单（不阻断）
 *   node scripts/quality/local-scan.js --gate   # 有 error 就退出码 1
 *   node scripts/quality/local-scan.js --warn   # 把 warning 也当阻断
 *
 * 清单写到 .data/sonar/local-issues.md（该目录已 gitignore）。
 *
 * 与 `pnpm run sonar:issues` 的区别：
 *   · sonar:issues  查 SonarCloud 上**最近一次分析**的结果（要令牌）
 *   · local-scan    在本机用 SonarJS 规则现扫（不要令牌，但不含
 *                    只有服务端才知道的东西：跨文件的数据流、覆盖率、
 *                    安全热点的人工复核结论）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const REPORT_DIR = path.join(ROOT, '.data', 'sonar');
const REPORT_FILE = path.join(REPORT_DIR, 'local-issues.md');

/** 规则 → 说明（只列最常撞的几条，其余给原文） */
const RULE_HINTS = {
    'sonarjs/no-dead-store': '赋值之后没被用过 —— 多半是重构留下的残留',
    'sonarjs/pseudo-random': 'Math.random 当随机源 —— 换成 crypto',
    'sonarjs/super-linear-regex': '正则可能平方级回溯 —— 数字段限界或拆开',
    'sonarjs/regex-complexity': '正则分支太复杂 —— 拆成数组或关键词表',
    'sonarjs/no-os-command-from-path': '命令从 PATH 里解析 —— 用绝对路径',
    'sonarjs/no-ignored-exceptions': 'catch 之后什么都不做 —— 加注释说明为什么',
    'sonarjs/no-extra-arguments': '传了函数不接的参数',
    'sonarjs/no-labels': '用了 label —— 改成提前 return',
    'sonarjs/no-clear-text-protocols': '代码里出现了 http:// 明文地址',
    '@typescript-eslint/no-unused-vars': '没用的变量或 import',
    '@typescript-eslint/no-explicit-any': '用了 any',
    'no-useless-escape': '正则里多余的转义',
    'react-hooks/exhaustive-deps': 'Hook 依赖数组不全 —— 补依赖或加注释说明原因',
};

async function main() {
    const gate = process.argv.includes('--gate');
    const treatWarningAsError = process.argv.includes('--warn');

    let ESLint;
    try {
        ({ ESLint } = require('eslint'));
    } catch {
        console.error('❌ 没找到 eslint —— 先跑 `pnpm install`');
        process.exit(1);
    }

    const eslint = new ESLint({ cwd: ROOT });
    const results = await eslint.lintFiles(['.']);

    const issues = [];
    for (const result of results) {
        const file = path.relative(ROOT, result.filePath).replace(/\\/g, '/');
        for (const message of result.messages) {
            issues.push({
                file,
                line: message.line ?? 0,
                column: message.column ?? 0,
                rule: message.ruleId || '(无规则)',
                severity: message.severity === 2 ? 'error' : 'warning',
                message: message.message || '',
            });
        }
    }

    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    // 按规则聚合 —— 同一类规则成片出现时通常是同一个根因
    const byRule = new Map();
    for (const issue of issues) {
        if (!byRule.has(issue.rule)) byRule.set(issue.rule, []);
        byRule.get(issue.rule).push(issue);
    }

    const lines = [];
    lines.push('# 本地 SonarJS 扫描结果');
    lines.push('');
    lines.push(`- 扫描范围：仓库根目录（src + scripts）`);
    lines.push(`- 规则来源：eslint-plugin-sonarjs（SonarCloud 对 JS/TS 用的同一套规则）`);
    lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push(`**error ${errors.length} 个，warning ${warnings.length} 个**`);
    lines.push('');

    if (!issues.length) {
        lines.push('没有发现问题。');
        lines.push('');
    } else {
        lines.push('## 按规则分布');
        lines.push('');
        lines.push('| 规则 | 数量 | 级别 | 说明 |');
        lines.push('| --- | ---: | --- | --- |');
        for (const [rule, list] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
            const sev = list.some((i) => i.severity === 'error') ? 'error' : 'warning';
            lines.push(`| ${rule} | ${list.length} | ${sev} | ${RULE_HINTS[rule] || ''} |`);
        }
        lines.push('');
        lines.push('## 逐条明细');
        lines.push('');
        for (const [rule, list] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
            lines.push(`### ${rule}（${list.length}）`);
            lines.push('');
            for (const issue of list) {
                lines.push(`- \`${issue.file}:${issue.line}:${issue.column}\` [${issue.severity}] ${issue.message}`);
            }
            lines.push('');
        }
    }

    const markdown = lines.join('\n');
    try {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
        fs.writeFileSync(REPORT_FILE, markdown, 'utf8');
    } catch {
        // 写不出去不影响判定
    }

    console.log(markdown);
    console.log(`📋 清单已写入 ${path.relative(ROOT, REPORT_FILE)}`);

    const blocking = treatWarningAsError ? issues : errors;
    if (gate && blocking.length > 0) {
        console.error('');
        console.error(`❌ 本地扫描未通过：${blocking.length} 个问题`);
        console.error('');
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(`❌ local-scan 执行失败：${error.message}`);
    process.exit(1);
});
