#!/usr/bin/env node
'use strict';


const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { validate: validateVersion, validateFormat } = require('./verify-version');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');

const RELEASE_TYPES = ['patch', 'minor', 'major'];

const RELEASE_TYPE_BY_NAME = {
    patch: 'patch',
    minor: 'minor',
    major: 'major',
};

const GIT = resolveExe('git');
const PNPM = resolveExe('pnpm');
const IS_WIN = process.platform === 'win32';

function getLastVersionTag() {
    try {
        const out = execFileSync(GIT, ['tag', '--list', '--sort=-v:refname'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            cwd: ROOT,
        });
        const tag = out
            .split('\n')
            .map((t) => t.trim())
            .find((t) => /^\d+\.\d+\.\d+$/.test(t));
        return tag || null;
    } catch {
        return null;
    }
}

function collectCommitTypes(sinceTag) {
    const range = sinceTag ? `${sinceTag}..HEAD` : 'HEAD';
    let log = '';
    try {
        log = execFileSync(GIT, ['log', '--format=%s%x1f%B%x1e', range], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            cwd: ROOT,
        });
    } catch {
        return { feat: false, breaking: false, total: 0 };
    }

    const records = log.split('\x1e').filter((r) => r.trim());
    let feat = false;
    let breaking = false;

    for (const record of records) {
        const [header = '', body = ''] = record.split('\x1f');
        const typeMatch = header.trim().match(/^([a-zA-Z]+)(\([^)]*\))?(!)?:/);
        if (!typeMatch) continue;
        if (typeMatch[1] === 'feat') feat = true;
        if (typeMatch[3] === '!') breaking = true;
        if (/^BREAKING[ -]CHANGE:/im.test(body)) breaking = true;
    }

    return { feat, breaking, total: records.length };
}

function checkReleaseTypeAgainstCommits(releaseType, sinceTag) {
    const { feat, breaking, total } = collectCommitTypes(sinceTag);
    const rank = { patch: 0, minor: 1, major: 2 };

    if (total === 0) {
        console.log('ℹ️  自上个版本以来没有提交，按当前类型发版');
        return { ok: true, required: releaseType, total, feat, breaking };
    }

    const required = breaking ? 'major' : feat ? 'minor' : 'patch';

    if (rank[releaseType] < rank[required]) {
        console.error('');
        console.error('❌ 发版类型与提交内容不匹配');
        console.error('');
        console.error(`   自上个版本以来共 ${total} 个提交，其中：`);
        if (breaking) console.error('   · 存在 BREAKING CHANGE 破坏性变更 → 需要 major');
        if (feat) console.error('   · 存在 feat 新功能              → 至少需要 minor');
        if (!breaking && !feat) console.error('   · 只有 fix/docs/chore 等        → patch 即可');
        console.error('');
        console.error(`   当前指定的是 ${releaseType}，请改用：pnpm run release:${required}`);
        console.error('   规范见 AGENTS.md 第 2.2 / 3.2 节');
        console.error('');
        return { ok: false, required, total, feat, breaking };
    }

    console.log(`✅ 发版类型校验通过（${releaseType}，本批 ${total} 个提交）`);
    return { ok: true, required, total, feat, breaking };
}

function checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (majorVersion < 18) {
        console.error('❌ 需要Node.js 18或更高版本');
        console.error(`当前版本: ${nodeVersion}`);
        process.exit(1);
    }

    console.log(`✅ Node.js版本检查通过: ${nodeVersion}`);
}

function readPackageVersion() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function hasTestScript() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        return typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim() !== '';
    } catch {
        return false;
    }
}

function runSonarGate() {
    if (process.env.SKIP_SONAR === '1') {
        console.log('⚠️  SKIP_SONAR=1 —— 本次跳过 Sonar 质量门禁');
        return;
    }

    console.log('🔍 Sonar 质量门禁...');
    try {
        execFileSync(
            process.execPath,
            [path.join(ROOT, 'scripts', 'quality', 'sonar-issues.js'), '--gate'],
            { stdio: 'inherit', cwd: ROOT }
        );
    } catch (error) {
        const undeterminable = error.status === 2;
        console.error('');
        if (undeterminable) {
            console.error('❌ Sonar 质量门禁无法判定，发版中止');
            console.error('');
            console.error('   不是代码有问题，是门禁自己没跑通（令牌无效 / 网络不通）。');
            console.error('   修好之后重新发版；确认要跳过可以用 SKIP_SONAR=1。');
        } else {
            console.error('❌ Sonar 质量门禁未通过，发版中止');
            console.error('');
            console.error('   完整清单见 .data/sonar/sonar-issues.md');
            console.error('   修完再跑一次 `pnpm run release:patch`；');
            console.error('   应急可用 SKIP_SONAR=1 跳过（会留痕在提交历史里）。');
        }
        console.error('');
        process.exit(1);
    }
}

function main() {
    const rawType = process.argv[2] || 'patch';

    const releaseType = RELEASE_TYPE_BY_NAME[rawType];
    if (!releaseType) {
        console.error(`❌ 无效的发布类型: ${JSON.stringify(rawType)}`);
        console.error(`   请使用: ${RELEASE_TYPES.join(' / ')}`);
        process.exit(1);
    }

    console.log(`🚀 开始 ${releaseType} 版本发布流程...`);

    try {
        checkNodeVersion();

        console.log('📋 检查Git工作目录状态...');
        try {
            execFileSync(GIT, ['diff-index', '--quiet', 'HEAD', '--'], { stdio: 'inherit', cwd: ROOT });
        } catch (error) {
            console.error('❌ 工作目录不干净，请先提交或暂存所有更改');
            process.exit(1);
        }

        const currentVersion = readPackageVersion();
        const versionErrors = validateFormat(currentVersion);
        if (versionErrors.length > 0) {
            console.error('❌ 当前版本号不符合规范：');
            versionErrors.forEach((e) => console.error(`   · ${e}`));
            process.exit(1);
        }
        console.log(`✅ 当前版本号: ${currentVersion}`);

        const lastTag = getLastVersionTag();
        console.log(
            lastTag
                ? `📌 上一个版本: ${lastTag}`
                : '📌 未找到历史版本 tag（首次发布）'
        );
        const typeCheck = checkReleaseTypeAgainstCommits(releaseType, lastTag);
        if (!typeCheck.ok) {
            process.exit(1);
        }

        console.log('📥 拉取最新代码...');
        execFileSync(GIT, ['pull', 'origin', 'master'], { stdio: 'inherit', cwd: ROOT });

        console.log('📦 安装工作区依赖...');
        execFileSync(PNPM, ['install'], { stdio: 'inherit', cwd: ROOT, shell: IS_WIN });

        console.log('🧪 运行测试...');
        if (!hasTestScript()) {
            console.log('ℹ️  没有找到测试脚本，跳过测试步骤');
        } else {
            try {
                execFileSync(PNPM, ['test'], { stdio: 'inherit', cwd: ROOT, shell: IS_WIN });
            } catch (error) {
                console.error('');
                console.error('❌ 单元测试未通过，发版中止');
                console.error('');
                console.error('   测试脚本存在但执行失败 —— 这是真实的测试失败，不是缺少脚本。');
                console.error('   请修好测试或回退相关改动后再发版。');
                console.error('');
                process.exit(1);
            }
        }

        runSonarGate();

        console.log(`📈 更新版本号 (${releaseType})...`);
        execFileSync(PNPM, ['version', releaseType, '--no-git-tag-version'], {
            stdio: 'inherit',
            cwd: ROOT,
            shell: IS_WIN,
        });
        const newVersion = readPackageVersion();
        console.log(`✅ 新版本: ${newVersion}`);

        const newVersionErrors = validateVersion(newVersion, null);
        if (newVersionErrors.length > 0) {
            console.error('❌ 新版本号不符合规范：');
            newVersionErrors.forEach((e) => console.error(`   · ${e}`));
            process.exit(1);
        }

        console.log('💾 提交版本更改...');
        execFileSync(GIT, ['add', 'package.json', 'pnpm-lock.yaml'], { stdio: 'inherit', cwd: ROOT });
        const commitArgs = ['commit', '-m', `chore(release): bump version to ${newVersion}`];
        if (process.env.SKIP_SONAR === '1') {
            commitArgs.push(
                '-m',
                '本次跳过 SonarCloud 质量门禁（SKIP_SONAR=1）：门禁无法判定或命中问题。'
            );
        }
        execFileSync(GIT, commitArgs, {
            stdio: 'inherit',
            cwd: ROOT,
        });

        console.log('🏷️  创建Git标签...');
        execFileSync(GIT, ['tag', '-a', newVersion, '-m', `Release ${newVersion}`], {
            stdio: 'inherit',
            cwd: ROOT,
        });

        console.log('📤 推送到远程仓库...');
        execFileSync(GIT, ['push', 'origin', 'master'], { stdio: 'inherit', cwd: ROOT });
        execFileSync(GIT, ['push', 'origin', newVersion], { stdio: 'inherit', cwd: ROOT });

        console.log('');
        console.log('🎉 发布流程完成！');
        console.log(`📋 版本 ${newVersion} 已发布`);
        console.log('🔄 GitHub Actions 将自动构建并创建 Release');
        console.log('🌐 请查看: https://github.com/Ruciazyt/qnote-elec/actions');
        console.log('');
        console.log('⚠️  别忘了轮换新版本里可能引入的密钥（AGENTS.md 第 4 节）');
    } catch (error) {
        console.error('❌ 发布过程中出现错误:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    main,
    getLastVersionTag,
    collectCommitTypes,
    checkReleaseTypeAgainstCommits,
    readPackageVersion,
    hasTestScript,
};
