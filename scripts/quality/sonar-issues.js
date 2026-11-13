#!/usr/bin/env node
'use strict';

/**
 * SonarCloud issue 清单 + 发版门禁
 *
 * 用法：
 *   node scripts/quality/sonar-issues.js            # 只出清单，不阻断
 *   node scripts/quality/sonar-issues.js --gate     # 有命中级别的问题就退出码 1（发版阻断用）
 *   node scripts/quality/sonar-issues.js --json     # 机器可读，输出 JSON
 *   node scripts/quality/sonar-issues.js --wait     # 等当前 commit 的分析跑完再取清单（CI 用）
 *   node scripts/quality/sonar-issues.js --branch dev
 *
 * 配置（环境变量）：
 *   SONAR_HOST_URL         默认 https://sonarcloud.io
 *   SONAR_PROJECT_KEY      默认 Ruciazyt_qnote-elec
 *   SONAR_TOKEN            访问令牌；也接受 .data/sonar/token 文件（该目录已被 gitignore）
 *   SONAR_BLOCK_SEVERITIES 拦截哪些严重级别，默认 BLOCKER,CRITICAL,MAJOR；写 all 表示全拦
 *   SONAR_REQUIRED=1       没有令牌时直接失败（默认是跳过并提示）
 *
 * 退出码：
 *   0  通过（或按配置跳过）
 *   1  查到了命中拦截级别的问题 —— 挡发版
 *   2  判不了（令牌无效、网络不通、API 报错）—— CI 里只告警，不挡发版
 *
 * 清单写到 .data/sonar/sonar-issues.md 与 .data/sonar/sonar-issues.json，
 * 那个目录在 .gitignore 里，不会进仓库。
 *
 * 注意：这里读的是 SonarCloud 上**最近一次分析**的结果，不是现扫一遍。
 * 现扫需要 JDK 17+ 与 sonar-scanner CLI，见 scripts/quality/sonar-scan.js，
 * 或者直接看 CI 的 SonarCloud 工作流。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');
const GIT = resolveExe('git');

/**
 * 去掉结尾的斜杠
 *
 * 不用正则 —— 一条 `/\/+$/` 会被正则规则自己挑出来（超线性回溯），
 * 而这里只是想去掉尾部几个斜杠，手写循环更直白。
 */
function trimTrailingSlash(url) {
    let end = url.length;
    while (end > 0 && url[end - 1] === '/') end--;
    return url.slice(0, end);
}

const HOST_URL = trimTrailingSlash(process.env.SONAR_HOST_URL || 'https://sonarcloud.io');
const PROJECT_KEY = process.env.SONAR_PROJECT_KEY || 'Ruciazyt_qnote-elec';
const TOKEN_FILE = path.join(ROOT, '.data', 'sonar', 'token');
const REPORT_DIR = path.join(ROOT, '.data', 'sonar');

/**
 * 默认拦截的问题类型
 *
 * 按**类型**拦，不按严重级别拦 —— 理由很实际：
 * SonarCloud 上一个中等规模的仓库，代码异味（CODE_SMELL）动辄几百条，
 * 而其中绝大多数是"函数太长了""认知复杂度高"这类度量问题。
 * 按严重级别拦（CRITICAL/MAJOR）会把发版永久堵死，门禁就废了。
 *
 * 缺陷（BUG）与漏洞（VULNERABILITY）才是真问题 —— 数量少、修得完、
 * 而且每一条都对应用户能感知的故障或安全风险。
 */
const DEFAULT_BLOCK_TYPES = ['BUG', 'VULNERABILITY'];

/** 类型的两套叫法 */
const TYPE_LABEL = {
    BUG: '缺陷',
    VULNERABILITY: '漏洞',
    CODE_SMELL: '代码异味',
    SECURITY: '安全',
    RELIABILITY: '可靠性',
    MAINTAINABILITY: '可维护性',
};

/** 严重级别的两套叫法（Cloud 用新的 impact 模型，老接口用旧模型） */
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

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* 令牌                                                                */
/* ------------------------------------------------------------------ */

/**
 * 取令牌：先环境变量，再 .data/sonar/token 文件
 *
 * 文件方式的用意：令牌不该进环境变量历史，也省得每开一个终端都重设。
 * .data/ 整个目录在 .gitignore 里。
 *
 * 文件里允许写 # 开头的注释行 —— 第一条非注释、非空的行才是令牌。
 * 这样文件可以自带说明（怎么生成、怎么粘贴），不用每次粘贴前先把注释删掉。
 */
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

/**
 * 拦截哪些类型的问题
 *
 * 默认 BUG + VULNERABILITY（真缺陷与漏洞）。
 * 写 all 表示连代码异味一起拦。
 */
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

/**
 * 拦截哪些严重级别
 *
 * 默认**空** = 不按级别再筛（只按类型判）。
 * 想收紧就填 SONAR_BLOCK_SEVERITIES=BLOCKER,CRITICAL,HIGH,MAJOR。
 */
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

/* ------------------------------------------------------------------ */
/* git                                                                 */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* SonarCloud API                                                      */
/* ------------------------------------------------------------------ */

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

/** 拉全部未解决的 issue（分页） */
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

/** 指标概览（violations / bugs / coverage 等） */
async function fetchMeasures() {
    // Cloud 上新指标名是 software_quality_*，老指标名（bugs / code_smells）已废弃；
    // 具体哪个版本认哪个不一样，所以先试全量，失败再退到最小集。
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
            // 指标名不被这个版本认（会返回 400），换下一组
        }
    }
    return {};
}

/** 最近一次分析（哪次提交、多大规模） */
async function fetchLastAnalysis() {
    try {
        const data = await api('/api/project_analyses/search', { project: PROJECT_KEY, ps: 1 });
        return (data.analyses || [])[0] || null;
    } catch {
        return null;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 等当前 commit 的分析出现在 SonarCloud 上
 *
 * 扫描器把结果提交上去之后，计算任务还要跑一会儿，
 * 立刻查 API 会拿到上一次的旧结果 —— 门禁就成了假通过。
 */
async function waitForAnalysis(revision, timeoutMs = 240000) {
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

/* ------------------------------------------------------------------ */
/* 报告                                                                */
/* ------------------------------------------------------------------ */

/** 把 component 字符串 "key:src/main/index.ts" 拆成路径 */
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

/**
 * 问题的「类型」
 *
 * 老模型给的是单个 type（BUG / VULNERABILITY / CODE_SMELL），
 * 新 impact 模型给的是 impactSoftwareQualities 数组
 * （SECURITY / RELIABILITY / MAINTAINABILITY），两套都兼容。
 */
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

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

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
        // 退出码 2 = 「判不了」，与退出码 1（「查到了问题」）区分开：
        // CI 里 1 挡发版，2 只告警 —— SonarCloud 抽风不该拦住一次正常发版。
        process.exit(2);
    }

    const summary = buildSummary(issues);
    const analysis = await fetchLastAnalysis();
    const blockTypeList = blockTypes();
    const blockSeverityList = blockSeverities();

    // ------------------------------------------------------------------
    // 分析结果不是当前提交 → 判不了，别拿旧结果当现状判
    // ------------------------------------------------------------------
    //
    // 为什么必须这么判：SonarCloud 上存的 issue 是**上一次扫描**的结果。
    // 那次扫描可能针对的是几天前、甚至几天前的提交 —— 期间代码早就改了，
    // 那些问题可能已经修掉（也可能更糟）。
    //
    // 拿旧结果判当前代码，两个方向都会错：
    //   · 旧结果里有、现在已修 → **误拦**（发版被一件不存在的事卡住）
    //   · 旧结果里没有、现在有 → **假通过**（带着没扫过的代码发版）
    //
    // 后者更危险 —— 它会让门禁在没有实际检查过代码的情况下放行。
    //
    // 所以：分析结果的 revision 与 HEAD 对不上时，判不了（退出码 2），
    // 由调用方决定是「告警继续」还是「中止」。CI 里 2 只告警。
    //
    // 什么时候会这样？扫描没跑成（SonarCloud 配额超限、令牌失效、
    // 扫描器本身报错）—— 这类情况本来就该「判不了」，
    // 而不是拿一份不知道多旧的清单来当现状。
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

    // 命中规则：类型在拦截名单里，且（没设级别过滤 或 级别也在名单里）。
    // 类型认不出来（接口没给）按拦截处理 —— 判不准的时候宁可保守。
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

    const markdown = renderMarkdown(issues, summary, meta);
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
                    blockSeverities: blockLevels,
                    summary: {
                        total: summary.total,
                        bySeverity: Object.fromEntries(summary.bySeverity),
                        byType: Object.fromEntries(summary.byType),
                    },
                    blockingCount: blocking.length,
                    issues,
                },
                null,
                2
            ),
            'utf8'
        );
    } catch {
        // 报告写不出去不影响判定 —— 清单已经打在控制台上了
    }

    if (opts.json) {
        console.log(
            JSON.stringify(
                {
                    total: summary.total,
                    blockingCount: blocking.length,
                    blockSeverities: blockLevels,
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
