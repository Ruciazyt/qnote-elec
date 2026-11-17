#!/usr/bin/env node
'use strict';


const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');
const HOOKS_DIR = path.join(ROOT, '.githooks');

const GIT = resolveExe('git');

const HOOK_FILES = ['commit-msg'];

function ensureExecutableMode() {
  const fixed = [];
  const pending = [];

  for (const name of HOOK_FILES) {
    const rel = `.githooks/${name}`;
    const tracked = execFileSync(GIT, ['ls-files', '--', rel], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();

    if (!tracked) {
      pending.push(rel);
      continue;
    }

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
