#!/usr/bin/env node
'use strict';


const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');
const GIT = resolveExe('git');

function trimTrailingSlash(url) {
    let end = url.length;
    while (end > 0 && url[end - 1] === '/') end--;
    return url.slice(0, end);
}

const HOST_URL = trimTrailingSlash(process.env.SONAR_HOST_URL || 'https://sonarcloud.io');
const PROJECT_KEY = process.env.SONAR_PROJECT_KEY || 'Ruciazyt_qnote-elec';
const TOKEN_FILE = path.join(ROOT, '.data', 'sonar', 'token');
const REPORT_DIR = path.join(ROOT, '.data', 'sonar');

const DEFAULT_BLOCK_TYPES = ['BUG', 'VULNERABILITY'];

const TYPE_LABEL = {
    BUG: '缺陷',
    VULNERABILITY: '漏洞',
    CODE_SMELL: '代码异味',
    SECURITY: '安全',
    RELIABILITY: '可靠性',
    MAINTAINABILITY: '可维护性',
};

const SEVERITIES = [
    'BLOCKER',
    'CRITICAL',
    'HIGH',
    'MAJOR',
    'MEDIUM',
    'MINOR',
    'LOW',
    'INFO',
];


function parseArgs(argv) {
    const opts = { gate: false, json: false, wait: false, branch: '', showAll: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--gate') opts.gate = true;
        else if (arg === '--json') opts.json = true;
        else if (arg === '--wait') opts.wait = true;
        else if (arg === '--all') opts.showAll = true;
        else if (arg === '--branch') opts.branch = argv[++i] || '';
        else if (arg === '--help' || arg === '-h') {
            console.log(
                '用法: node scripts/quality/sonar-issues.js [--gate] [--json] [--wait] [--branch <name>] [--all]'
            );
            process.exit(0);
        }
    }
    return opts;
}


function readToken() {
    const fromEnv = (process.env.SONAR_TOKEN || '').trim();
    if (fromEnv) return fromEnv;
    try {
        const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
        const line = raw
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith('#'));
        return line || '';
    } catch {
        return '';
    }
}

function blockTypes() {
    const raw = (process.env.SONAR_BLOCK_TYPES || '').trim();
    if (!raw) return DEFAULT_BLOCK_TYPES.slice();
    if (raw.toLowerCase() === 'all') {
        return ['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY', 'RELIABILITY', 'MAINTAINABILITY'];
    }
    const list = raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    return list.length ? list : DEFAULT_BLOCK_TYPES.slice();
}

function blockSeverities() {
    const raw = (process.env.SONAR_BLOCK_SEVERITIES || '').trim();
    if (!raw) return [];
    if (raw.toLowerCase() === 'all') return SEVERITIES.slice();
    const list = raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SEVERITIES.includes(s));
    return list;
}


function git(...args) {
    try {
        return execFileSync(GIT, args, { encoding: 'utf8', cwd: ROOT }).trim();
    } catch {
        return '';
    }
}

function headRevision() {
    return git('rev-parse', 'HEAD');
}

function currentBranch() {
    return git('rev-parse', '--abbrev-ref', 'HEAD');
}


let TOKEN = '';

async function api(pathname, params = {}) {
    const url = new URL(HOST_URL + pathname);
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
    }
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/json',
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`${url.pathname} 返回 ${res.status}：${body.slice(0, 300)}`);
    }
    return res.json();
}

async function fetchIssues(branch) {
    const issues = [];
    const pageSize = 500;
    for (let page = 1; page <= 20; page++) {
        const data = await api('/api/issues/search', {
            componentKeys: PROJECT_KEY,
            resolved: 'false',
            ps: pageSize,
            p: page,
            s: 'FILE_LINE',
            branch: branch || undefined,
        });
        const batch = data.issues || [];
        issues.push(...batch);
        const total = data.total || 0;
        if (batch.length === 0 || issues.length >= total) break;
    }
    return issues;
}

async function fetchMeasures() {
    const lists = [
        [
            'violations',
            'new_violations',
            'bugs',
            'vulnerabilities',
            'code_smells',
            'security_hotspots',
            'coverage',
            'duplicated_lines_density',
            'software_quality_reliability_issues',
            'software_quality_security_issues',
            'software_quality_maintainability_issues',
        ],
        ['violations', 'coverage', 'duplicated_lines_density'],
    ];
    for (const metricKeys of lists) {
        try {
            const data = await api('/api/measures/component', {
                component: PROJECT_KEY,
                metricKeys: metricKeys.join(','),
            });
            const map = {};
            for (const measure of data.component?.measures || []) {
                map[measure.metric] = measure.value;
            }
            return map;
        } catch {
        }
    }
    return {};
}

async function fetchLastAnalysis() {
    try {
        const data = await api('/api/project_analyses/search', { project: PROJECT_KEY, ps: 1 });
        return (data.analyses || [])[0] || null;
    } catch {
        return null;
    }
}

async function fetchAnalyses(branch) {
    try {
        const data = await api('/api/project_analyses/search', {
            project: PROJECT_KEY,
            ps: 20,
            branch: branch || undefined,
        });
        return (data.analyses || []).map((analysis) => ({
            date: analysis.date || '',
            revision: (analysis.revision || '').slice(0, 7),
            version: analysis.version || '',
        }));
    } catch {
        return [];
    }
}

async function fetchGateStatus(branch) {
    try {
        const data = await api('/api/qualitygates/project_status', {
            projectKey: PROJECT_KEY,
            branch: branch || undefined,
        });
        const status = data.projectStatus || null;
        return {
            status: (status && status.status) || 'UNKNOWN',
            conditions: ((status && status.conditions) || []).map((condition) => ({
                metricKey: condition.metricKey,
                status: condition.status,
                comparator: condition.comparator,
                actualValue: condition.actualValue ?? null,
                errorThreshold: condition.errorThreshold ?? null,
            })),
            newCodePeriod: (data.newCodePeriod && data.newCodePeriod.value) || null,
        };
    } catch {
        return null;
    }
}

async function fetchNewCodeMeasures(branch) {
    const metricKeys = [
        'new_coverage',
        'new_lines_to_cover',
        'new_uncovered_lines',
        'new_duplicated_lines_density',
        'new_bugs',
        'new_vulnerabilities',
        'new_code_smells',
        'new_security_hotspots_reviewed',
    ];
    const params = {
        component: PROJECT_KEY,
        branch: branch || undefined,
    };
    try {
        const data = await api('/api/measures/component', {
            ...params,
            metricKeys: metricKeys.join(','),
        });
        const measures = (data.component && data.component.measures) || [];
        return Object.fromEntries(measures.map((measure) => [measure.metric, measure.value]));
    } catch {
    }
    const result = {};
    for (const metricKey of metricKeys) {
        try {
            const data = await api('/api/measures/component', { ...params, metricKeys: metricKey });
            const measures = (data.component && data.component.measures) || [];
            if (measures.length) result[metricKey] = measures[0].value;
        } catch {
        }
    }
    return Object.keys(result).length ? result : null;
}

function renderGateSection(gate, newCode, analyses) {
    const lines = [];
    lines.push('');
    lines.push('## 质量门禁（SonarCloud 自带的那道）');
    lines.push('');
    lines.push('| 项 | 值 |');
    lines.push('| --- | --- |');
    lines.push('| 状态 | ' + gate.status + ' |');
    if (gate.newCodePeriod) lines.push('| 新代码周期 | ' + gate.newCodePeriod + ' |');
    if (newCode) {
        for (const [key, value] of Object.entries(newCode)) {
            lines.push('| ' + key + ' | ' + value + ' |');
        }
    }
    if (analyses && analyses.length) {
        lines.push('');
        lines.push('| 提交 | 版本 | 时间 |');
        lines.push('| --- | --- | --- |');
        for (const analysis of analyses.slice(0, 10)) {
            lines.push('| ' + analysis.revision + ' | ' + analysis.version + ' | ' + analysis.date + ' |');
        }
    }
    lines.push('');
    lines.push('| 条件 | 实际值 | 要求 | 状态 |');
    lines.push('| --- | --- | --- | --- |');
    for (const condition of gate.conditions) {
        lines.push(
            '| ' + condition.metricKey +
            ' | ' + condition.actualValue +
            ' | ' + condition.comparator + ' ' + condition.errorThreshold +
            ' | ' + condition.status + ' |'
        );
    }
    lines.push('');
    return lines.join('\n');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// 关掉 Automatic Analysis 之后，分析结果来自 CI 扫描（装依赖 + 跑覆盖率测试 + 扫描）
// ，比自动分析慢得多，4 分钟等不到。留 10 分钟，够 CI 扫描把结果传上来并算完。
async function waitForAnalysis(revision, timeoutMs = 600000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const data = await api('/api/project_analyses/search', { project: PROJECT_KEY, ps: 5 });
        last = (data.analyses || [])[0] || null;
        if (last && last.revision === revision) return last;
        await sleep(5000);
    }
    return last;
}


function componentPath(component) {
    const idx = component.indexOf(':');
    return idx >= 0 ? component.slice(idx + 1) : component;
}

function countBy(issues, key) {
    const map = new Map();
    for (const issue of issues) {
        const value = issue[key] || 'UNKNOWN';
        map.set(value, (map.get(value) || 0) + 1);
    }
    return map;
}

function buildSummary(issues) {
    const bySeverity = countBy(issues, 'severity');
    const byType = new Map();
    for (const issue of issues) {
        for (const type of issueTypes(issue)) {
            byType.set(type, (byType.get(type) || 0) + 1);
        }
    }
    const byRule = countBy(issues, 'rule');
    return {
        total: issues.length,
        bySeverity,
        byType,
        byRule,
    };
}

function issueTypes(issue) {
    if (Array.isArray(issue.impactSoftwareQualities) && issue.impactSoftwareQualities.length) {
        return issue.impactSoftwareQualities;
    }
    return issue.type ? [issue.type] : [];
}

function typeLabel(issue) {
    const types = issueTypes(issue);
    if (!types.length) return '未分类';
    return types.map((t) => `${t}（${TYPE_LABEL[t] || ''}）`).join('、');
}

function issueLine(issue) {
    const file = componentPath(issue.component || '');
    const loc = issue.line ? `${file}:${issue.line}` : file;
    return `[${issue.severity}] ${issue.rule} ${loc} — ${issue.message}`;
}

function issueUrl(issue) {
    return `${HOST_URL}/project/issues?id=${encodeURIComponent(PROJECT_KEY)}&issues=${encodeURIComponent(
        issue.key
    )}&open=${encodeURIComponent(issue.key)}`;
}

function renderMarkdown(issues, summary, meta) {
    const lines = [];
    lines.push('# SonarCloud 质量清单');
    lines.push('');
    lines.push(`- 项目：${PROJECT_KEY}`);
    lines.push(`- 实例：${HOST_URL}`);
    lines.push(`- 分支口径：${meta.branch || '主分支（master）'}`);
    lines.push(`- SonarCloud 最近分析：${meta.analysisDate || '未知'}${meta.analysisRevision ? '（提交 ' + meta.analysisRevision.slice(0, 7) + '）' : ''}`);
    lines.push(`- 本地 HEAD：${meta.headRevision ? meta.headRevision.slice(0, 7) : '未知'}`);
    lines.push(`- 拦截类型：${meta.blockTypes.join(' / ')}`);
    lines.push(
        `- 拦截级别：${meta.blockSeverities.length ? meta.blockSeverities.join(' / ') : '不限（只按类型判）'}`
    );
    lines.push(`- 生成时间：${meta.now}`);
    if (meta.stale) {
        lines.push('');
        lines.push(
            '> ⚠️ 本地 HEAD 与 SonarCloud 上的分析不是同一个提交 —— 清单反映的是**上一次扫描**的结果，不是当前工作区的状态。'
        );
    }
    lines.push('');
    lines.push('## 概览');
    lines.push('');
    lines.push(`未解决问题总数：**${summary.total}**`);
    lines.push('');
    lines.push('| 严重级别 | 数量 |');
    lines.push('| --- | ---: |');
    for (const severity of SEVERITIES) {
        const count = summary.bySeverity.get(severity) || 0;
        if (!count) continue;
        lines.push(`| ${severity} | ${count} |`);
    }
    const unknown = summary.bySeverity.get('UNKNOWN') || 0;
    if (unknown) {
        lines.push(`| UNKNOWN（级别未知） | ${unknown} |`);
    }
    lines.push('');
    lines.push('| 类型 | 数量 | 是否拦截 |');
    lines.push('| --- | ---: | --- |');
    for (const type of ['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY', 'RELIABILITY', 'MAINTAINABILITY']) {
        const count = summary.byType.get(type) || 0;
        if (!count) continue;
        const blocks = meta.blockTypes.includes(type) ? '是' : '否';
        lines.push(`| ${type}（${TYPE_LABEL[type]}） | ${count} | ${blocks} |`);
    }
    lines.push('');

    const rules = [...summary.byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (rules.length) {
        lines.push('## 规则分布（前 15）');
        lines.push('');
        lines.push('| 规则 | 数量 |');
        lines.push('| --- | ---: |');
        for (const [rule, count] of rules) {
            lines.push(`| ${rule} | ${count} |`);
        }
        lines.push('');
    }

    lines.push('## 问题清单');
    lines.push('');
    if (!issues.length) {
        lines.push('没有未解决的问题。');
        lines.push('');
        return lines.join('\n');
    }

    const sorted = issues.slice().sort((a, b) => {
        const sa = SEVERITIES.indexOf(a.severity);
        const sb = SEVERITIES.indexOf(b.severity);
        if (sa !== sb) return sa - sb;
        return componentPath(a.component || '').localeCompare(componentPath(b.component || ''));
    });

    const shown = meta.showAll ? sorted : sorted.slice(0, 200);
    for (const issue of shown) {
        const file = componentPath(issue.component || '');
        const loc = issue.line ? `${file}:${issue.line}` : file;
        lines.push(`### ${issue.severity} · ${issue.rule} · ${typeLabel(issue)}`);
        lines.push('');
        lines.push(`- 位置：\`${loc}\``);
        lines.push(`- 说明：${issue.message}`);
        lines.push(`- 链接：${issueUrl(issue)}`);
        lines.push('');
    }
    if (shown.length < sorted.length) {
        lines.push(`> 还有 ${sorted.length - shown.length} 条未列出，用 \`--all\` 看全量。`);
        lines.push('');
    }
    return lines.join('\n');
}


async function main() {
    const opts = parseArgs(process.argv.slice(2));

    TOKEN = readToken();
    if (!TOKEN) {
        const message = [
            'ℹ️  没有找到 SonarCloud 令牌，跳过质量门禁。',
            '',
            '   令牌来源（任选其一）：',
            '   · 环境变量 SONAR_TOKEN',
            `   · 文件 ${path.relative(ROOT, TOKEN_FILE)}（该目录已被 gitignore）`,
            '',
            '   生成方式见 docs/SONAR.md。',
        ].join('\n');
        if (process.env.SONAR_REQUIRED === '1') {
            console.error(message);
            process.exit(1);
        }
        console.log(message);
        return;
    }

    const branch = opts.branch || '';
    const head = headRevision();

    if (opts.wait && head) {
        process.stdout.write('🔍 等待 SonarCloud 完成本次分析...');
        const analysis = await waitForAnalysis(head);
        process.stdout.write('\n');
        if (!analysis || analysis.revision !== head) {
            console.warn(
                `⚠️  在超时时间内没等到提交 ${head.slice(0, 7)} 的分析结果。`
            );
        }
    }

    let issues;
    try {
        issues = await fetchIssues(branch);
    } catch (error) {
        console.error('');
        console.error(`❌ 拉取 SonarCloud issue 失败：${error.message}`);
        console.error('');
        console.error('   确认 SONAR_TOKEN 有效，且该令牌对项目有分析权限。');
        console.error('');
        process.exit(2);
    }

    const summary = buildSummary(issues);
    const analysis = await fetchLastAnalysis();
    const gate = await fetchGateStatus(branch);
    const newCode = await fetchNewCodeMeasures(branch);
    const analyses = await fetchAnalyses(branch);
    if (gate && gate.status !== 'OK') {
        const failed = gate.conditions.filter((condition) => condition.status === 'ERROR');
        console.error('');
        console.error('⚠️  SonarCloud 自己的质量门禁没通过：' + gate.status);
        for (const condition of failed) {
            console.error(
                '   · ' + condition.metricKey + ' 实际 ' + condition.actualValue +
                '（要求 ' + condition.comparator + ' ' + condition.errorThreshold + '）'
            );
        }
        console.error('');
    }
    const blockTypeList = blockTypes();
    const blockSeverityList = blockSeverities();

    const stale = Boolean(analysis && head && analysis.revision !== head);
    if (opts.gate && stale) {
        console.error('');
        console.error('⚠️  SonarCloud 质量门禁无法判定：分析结果不是当前提交的');
        console.error('');
        console.error(`   当前提交：${head.slice(0, 7)}`);
        console.error(
            `   最近一次分析：${analysis.revision ? analysis.revision.slice(0, 7) : '（没有）'}` +
                (analysis?.date ? `（${new Date(analysis.date).toLocaleString('zh-CN')}）` : '')
        );
        console.error('');
        console.error('   这份清单反映的是上一次扫描时的代码，不能拿来判现在的代码 ——');
        console.error('   拿它判会两个方向都错：已修的问题误拦，没扫到的问题假通过。');
        console.error('');
        console.error('   排查扫描为什么没跑成（常见原因：SonarCloud 组织的 LOC 配额超限、');
        console.error('   令牌失效、扫描器报错）。清单仍在 .data/sonar/sonar-issues.md。');
        console.error('');
        process.exit(2);
    }

    const blocking = issues.filter((issue) => {
        const types = issueTypes(issue);
        if (!types.length) return true;
        if (!types.some((type) => blockTypeList.includes(type))) return false;
        if (!blockSeverityList.length) return true;
        return blockSeverityList.includes(issue.severity);
    });

    const meta = {
        branch,
        headRevision: head,
        analysisDate: analysis?.date ? new Date(analysis.date).toLocaleString('zh-CN') : '',
        analysisRevision: analysis?.revision || '',
        blockTypes: blockTypeList,
        blockSeverities: blockSeverityList,
        now: new Date().toLocaleString('zh-CN'),
        showAll: opts.showAll,
        stale,
    };

    let markdown = renderMarkdown(issues, summary, meta);
    if (gate) markdown += renderGateSection(gate, newCode, analyses);
    try {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
        fs.writeFileSync(path.join(REPORT_DIR, 'sonar-issues.md'), markdown, 'utf8');
        fs.writeFileSync(
            path.join(REPORT_DIR, 'sonar-issues.json'),
            JSON.stringify(
                {
                    projectKey: PROJECT_KEY,
                    hostUrl: HOST_URL,
                    branch: branch || null,
                    headRevision: head,
                    analysisRevision: meta.analysisRevision,
                    blockSeverities: blockSeverityList,
                    summary: {
                        total: summary.total,
                        bySeverity: Object.fromEntries(summary.bySeverity),
                        byType: Object.fromEntries(summary.byType),
                    },
                    blockingCount: blocking.length,
                    gate,
                    newCode,
                    analyses,
                    issues,
                },
                null,
                2
            ),
            'utf8'
        );
    } catch {
    }

    if (opts.json) {
        console.log(
            JSON.stringify(
                {
                    total: summary.total,
                    blockingCount: blocking.length,
                    blockSeverities: blockSeverityList,
                    issues,
                },
                null,
                2
            )
        );
    } else {
        console.log(markdown);
        console.log(`📋 清单已写入 ${path.relative(ROOT, path.join(REPORT_DIR, 'sonar-issues.md'))}`);
    }

    if (opts.gate && blocking.length > 0) {
        console.error('');
        console.error(`❌ Sonar 质量门禁未通过：${blocking.length} 个命中拦截级别的问题`);
        console.error('');
        console.error('   完整清单见 .data/sonar/sonar-issues.md');
        console.error('   应急可用 SKIP_SONAR=1 跳过本次门禁（会留痕在提交历史里）。');
        console.error('');
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(`❌ sonar-issues 执行失败：${error.message}`);
    process.exit(1);
});
