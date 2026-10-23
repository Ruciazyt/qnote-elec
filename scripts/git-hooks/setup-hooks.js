#!/usr/bin/env node
'use strict';

/**
 * 启用仓库自带的 git 钩子
 *
 * 做的是 `git config core.hooksPath .githooks` —— 写进本地 .git/config，
 * 不会进版本库，别的机器克隆后各自跑一次即可。
 *
 * 之所以不用 husky：它会往依赖树里再加几十个包，而本项目的 postinstall
 * （electron-builder install-app-deps）在部分机器上本来就会失败，
 * 不值得为装一个钩子再扩大安装链路的风险面。
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');
const HOOKS_DIR = path.join(ROOT, '.githooks');

// 解析成绝对路径再执行 —— 靠 PATH 查找的命令可以被同名可执行文件劫持，
// SonarCloud 会把这记成 S4036 安全漏洞（质量门禁里 Security Rating 直接掉到 E）
const GIT = resolveExe('git');

/** 需要可执行位的钩子文件 */
const HOOK_FILES = ['commit-msg'];

/**
 * 确保钩子文件在 git 索引里是可执行位（100755）
 *
 * git 只运行"可执行"的钩子文件：权限不对时它不报错，而是**静默跳过** ——
 * 规范看着写了，实际拦不住任何东西。
 *
 * Windows 上 core.fileMode 默认是 false，提交时文件一律记成 100644；
 * 克隆到 Linux/macOS 上钩子就会失效。文件已被追踪时把模式补正，
 * 还没追踪时给出该敲的命令。
 */
function ensureExecutableMode() {
  const fixed = [];
  const pending = [];

  for (const name of HOOK_FILES) {
    const rel = `.githooks/${name}`;
    // 不加 --error-unmatch：未追踪时它会以退出码 1 结束，execFileSync 会抛异常
    const tracked = execFileSync(GIT, ['ls-files', '--', rel], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();

    if (!tracked) {
      pending.push(rel);
      continue;
    }

    // 已经记成 100755 就不用动
    const mode = execFileSync(GIT, ['ls-files', '--stage', '--', rel], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim().split(/\s+/)[0];

    if (mode === '100755') continue;

    execFileSync(GIT, ['update-index', '--chmod=+x', '--', rel], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    fixed.push(`${rel}（${mode} → 100755）`);
  }

  if (fixed.length) {
    console.log('✅ 已补正钩子文件的可执行位：');
    fixed.forEach((f) => console.log(`   · ${f}`));
  }

  if (pending.length) {
    console.log('');
    console.log('⚠️  以下钩子文件还没被 git 追踪，请提交时补上可执行位：');
    pending.forEach((f) => console.log(`   · git add -- "${f}"`));
    console.log('   · git update-index --chmod=+x -- ".githooks/commit-msg"');
    console.log('   不补的话，Linux/macOS 上 git 会静默跳过这个钩子。');
  }
}

function main() {
  if (!fs.existsSync(HOOKS_DIR)) {
    console.error('❌ 找不到 .githooks 目录，请在项目根目录执行');
    process.exit(1);
  }

  try {
    execFileSync(GIT, ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    console.error('❌ 当前目录不是 git 仓库');
    process.exit(1);
  }

  try {
    execFileSync(GIT, ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'inherit' });
    console.log('✅ 已启用 .githooks（提交信息将按 Angular 规范校验）');
    console.log('   查看当前设置: git config core.hooksPath');
    console.log('   关闭:         git config --unset core.hooksPath');
    ensureExecutableMode();
  } catch (err) {
    console.error('❌ 设置 git config 失败:', err.message);
    process.exit(1);
  }
}

main();
