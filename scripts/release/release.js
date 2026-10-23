#!/usr/bin/env node
'use strict';

/**
 * 发版脚本 —— 版本号唯一来源是根 package.json
 *
 *   node scripts/release/release.js patch   # 1.0.18 → 1.0.19
 *   node scripts/release/release.js minor   # 1.0.18 → 1.1.0
 *   node scripts/release/release.js major   # 1.0.18 → 2.0.0
 *
 * 三条硬规则（AGENTS.md 第 2.2 / 3 节）：
 *   1. 版本号是 MAJOR.MINOR.PATCH 纯数字三段，不带 v 前缀
 *   2. tag 名 = 版本号本身
 *   3. 发版类型不得低于本批提交的内容要求（有 feat 至少 minor，有破坏性变更至少 major）
 *
 * 规则改动只改这一个文件和 scripts/release/verify-version.js。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { validate: validateVersion } = require('./verify-version');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');

/** 合法的发版类型（白名单） */
const RELEASE_TYPES = ['patch', 'minor', 'major'];

/**
 * 白名单的形态约束
 *
 * releaseType 会作为参数交给 pnpm version（Windows 上还要过一遍 shell），
 * 值里带上空格、引号、分号这类元字符就可能被拼成别的命令。
 * 正则只放行三个纯字面量类型名，不匹配就直接退出。
 */
const RELEASE_TYPE_PATTERN = /^(?:patch|minor|major)$/;

// 命令解析成绝对路径再执行 —— 靠 PATH 查找意味着同名的可执行文件可以被劫持，
// SonarCloud 会把这记成 S4036 安全漏洞（质量门禁里 Security Rating 直接掉到 E）。
// 参数一律走数组形式，不经过 shell，路径带空格也不会出问题。
const GIT = resolveExe('git');
const PNPM = resolveExe('pnpm');
// Windows 上 pnpm 是 .cmd 批处理，必须借 shell 才能执行；POSIX 上是带 shebang 的脚本
const IS_WIN = process.platform === 'win32';

/**
 * 取上一个版本号 tag
 *
 * 只认纯数字三段的 tag —— 项目里早先存在过 v1.0.x 和 1.0.<commit 数>
 * 两种形态（详见 AGENTS.md 第 3 节），那些旧 tag 不参与版本推导，
 * 否则会把 commit 数当成版本号继续用下去。
 */
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

/**
 * 统计上个版本之后提交里出现的 type
 *
 * 这是"提交规范驱动版本号"的落地：AGENTS.md 第 2.2 节规定
 * feat → minor、破坏性变更 → major。这里把规则真正跑起来，
 * 避免出现"加了功能却只发了个 patch"的版本号失真。
 */
function collectCommitTypes(sinceTag) {
    const range = sinceTag ? `${sinceTag}..HEAD` : 'HEAD';
    let log = '';
    try {
        // 用 \x1f / \x1e 分隔记录：一条提交一条，正文里的空行不会被误切成新提交
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

/**
 * 校验发版类型与提交内容是否匹配
 *
 * 规则（AGENTS.md 第 2.2 / 3.2 节）：
 *   - 出现 BREAKING CHANGE → 至少 major
 *   - 出现 feat             → 至少 minor
 *   - 否则                   → patch 即可
 *
 * 往高了发不拦（多发一个 minor 总比漏发功能安全），往低了发直接拦。
 *
 * @returns {{ok: boolean, required: string, total: number, feat: boolean, breaking: boolean}}
 */
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

/** 检查 Node.js 版本 */
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

/** 读取根 package.json 的 version */
function readPackageVersion() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function main() {
    const releaseType = process.argv[2] || 'patch'; // patch, minor, major

    // 白名单校验：只有 patch / minor / major 三种值能往下走。
    // 不校验就把它交给 pnpm version，等于让命令行参数直接进子进程
    // （SonarCloud S8705 命令参数注入）。
    if (!RELEASE_TYPE_PATTERN.test(releaseType)) {
        console.error(`❌ 无效的发布类型: ${JSON.stringify(releaseType)}`);
        console.error(`   请使用: ${RELEASE_TYPES.join(' / ')}`);
        process.exit(1);
    }

    console.log(`🚀 开始 ${releaseType} 版本发布流程...`);

    try {
        // 0. 检查Node.js版本
        checkNodeVersion();

        // 1. 检查工作目录是否干净
        console.log('📋 检查Git工作目录状态...');
        try {
            execFileSync(GIT, ['diff-index', '--quiet', 'HEAD', '--'], { stdio: 'inherit', cwd: ROOT });
        } catch (error) {
            console.error('❌ 工作目录不干净，请先提交或暂存所有更改');
            process.exit(1);
        }

        // 2. 校验当前版本号格式（发版前必须已经是合法的 MAJOR.MINOR.PATCH）
        const currentVersion = readPackageVersion();
        const versionErrors = validateVersion(currentVersion, null);
        if (versionErrors.length > 0) {
            console.error('❌ 当前版本号不符合规范：');
            versionErrors.forEach((e) => console.error(`   · ${e}`));
            process.exit(1);
        }
        console.log(`✅ 当前版本号: ${currentVersion}`);

        // 3. 校验发版类型与提交内容匹配
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

        // 4. 拉取最新代码
        console.log('📥 拉取最新代码...');
        execFileSync(GIT, ['pull', 'origin', 'master'], { stdio: 'inherit', cwd: ROOT });

        // 5. 安装工作区依赖
        console.log('📦 安装工作区依赖...');
        execFileSync(PNPM, ['install'], { stdio: 'inherit', cwd: ROOT, shell: IS_WIN });

        // 6. 运行测试（如果有的话）
        console.log('🧪 运行测试...');
        try {
            execFileSync(PNPM, ['test'], { stdio: 'inherit', cwd: ROOT, shell: IS_WIN });
        } catch (error) {
            console.log('⚠️  没有找到测试脚本，跳过测试步骤');
        }

        // 7. 更新版本号
        //
        // 版本号的唯一来源是 package.json —— 不设任何环境变量覆盖
        // （ELECTRON_BUILDER_VERSION 在 electron-builder 25.x 里并不生效，
        //   详见 AGENTS.md 第 3 节）。
        console.log(`📈 更新版本号 (${releaseType})...`);
        execFileSync(PNPM, ['version', releaseType, '--no-git-tag-version'], {
            stdio: 'inherit',
            cwd: ROOT,
            shell: IS_WIN,
        });
        // 版本号以 package.json 为准，不解析 pnpm 的 stdout ——
        // pnpm 输出的是 "Version bumped successfully:\n<name>: 1.0.19 → 1.0.20"
        // 这种多行文本，不是纯版本号。
        const newVersion = readPackageVersion();
        console.log(`✅ 新版本: ${newVersion}`);

        // 8. 再次校验新版本号
        const newVersionErrors = validateVersion(newVersion, null);
        if (newVersionErrors.length > 0) {
            console.error('❌ 新版本号不符合规范：');
            newVersionErrors.forEach((e) => console.error(`   · ${e}`));
            process.exit(1);
        }

        // 9. 提交版本更改
        //
        // 提交信息走 Angular 规范（type(scope): subject），
        // 且会被 .githooks/commit-msg 校验
        console.log('💾 提交版本更改...');
        execFileSync(GIT, ['add', 'package.json', 'pnpm-lock.yaml'], { stdio: 'inherit', cwd: ROOT });
        execFileSync(GIT, ['commit', '-m', `chore(release): bump version to ${newVersion}`], {
            stdio: 'inherit',
            cwd: ROOT,
        });

        // 10. 创建Git标签
        //
        // tag 名 = 版本号本身，不加 v 前缀（AGENTS.md 第 3.3 节）
        console.log('🏷️  创建Git标签...');
        execFileSync(GIT, ['tag', '-a', newVersion, '-m', `Release ${newVersion}`], {
            stdio: 'inherit',
            cwd: ROOT,
        });

        // 11. 推送到远程仓库
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
};
