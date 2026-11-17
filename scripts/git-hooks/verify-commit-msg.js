#!/usr/bin/env node
'use strict';


const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveExe } = require('../lib/resolve-exe');

const REPO_ROOT = path.resolve(__dirname, '../..');

const GIT = resolveExe('git');

const GIT_DIR = (() => {
  try {
    return execFileSync(GIT, ['rev-parse', '--absolute-git-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
})();

function isInside(base, target) {
  if (!base) return false;
  const rel = path.relative(base, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveMessagePath(arg) {
  const target = path.resolve(REPO_ROOT, arg);
  if (!isInside(REPO_ROOT, target) && !isInside(GIT_DIR, target)) {
    throw new Error(`提交信息文件必须位于仓库目录之内: ${arg}`);
  }
  return target;
}

const TYPES = new Set([
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
]);

const MAX_HEADER_LENGTH = 72;

const MAX_SUBJECT_CJK = 30;
const MAX_SUBJECT_ASCII = 72;

const AUTO_PREFIXES = ['Merge ', 'Revert ', 'fixup!', 'squash!', 'amend!'];

const SCOPE_PATTERN = /^[a-z0-9][a-z0-9\-_/,]*$/;

function countCjk(text) {
  const matched = text.match(/[㐀-鿿豈-﫿]/g);
  return matched ? matched.length : 0;
}

function validate(message) {
  const errors = [];
  const lines = message.split(/\r?\n/);
  const header = (lines[0] || '').trim();

  if (!header) {
    return ['提交信息不能为空'];
  }

  if (AUTO_PREFIXES.some((prefix) => header.startsWith(prefix))) {
    return [];
  }

  if (header.length > MAX_HEADER_LENGTH) {
    errors.push(
      `首行长度 ${header.length} 字符，超过 ${MAX_HEADER_LENGTH} 上限`
    );
  }

  const headerPattern = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?: (.+)$/;
  const matched = header.match(headerPattern);
  if (!matched) {
    errors.push(
      '头部格式不符合 <type>(<scope>): <subject>，例如 feat(updater): 增加应用更新卡片'
    );
    return errors;
  }

  const [, rawType, scope, , subject] = matched;

  if (!TYPES.has(rawType)) {
    errors.push(
      `type "${rawType}" 不在允许列表内，可用值：${[...TYPES].join(' / ')}`
    );
  }

  if (scope !== undefined) {
    if (!scope) {
      errors.push('scope 不能为空，括号里要么写模块名，要么整个括号省略');
    } else if (!SCOPE_PATTERN.test(scope)) {
      errors.push(
        `scope "${scope}" 含非法字符，只能用小写字母、数字、- _ , /`
      );
    }
  }

  if (!subject || !subject.trim()) {
    errors.push('subject 不能为空');
  } else {
    if (/[。.]$/.test(subject.trim())) {
      errors.push('subject 末尾不要加句号');
    }
    if (/[了的]$/.test(subject.trim())) {
      errors.push('subject 末尾不要用「了」「的」这类完成态，改为祈使句');
    }
    if (/^已经/.test(subject.trim())) {
      errors.push('subject 不要以「已经」开头，改为祈使句');
    }
    if (/\s{2,}/.test(subject)) {
      errors.push('subject 里不要有连续空格');
    }

    const cjkCount = countCjk(subject);
    if (cjkCount > 0) {
      if (cjkCount > MAX_SUBJECT_CJK) {
        errors.push(
          `subject 中文长度 ${cjkCount} 字，超过 ${MAX_SUBJECT_CJK} 字上限`
        );
      }
    } else if (subject.length > MAX_SUBJECT_ASCII) {
      errors.push(
        `subject 长度 ${subject.length} 字符，超过 ${MAX_SUBJECT_ASCII} 字符上限`
      );
    }
  }

  const breakingFooters = lines.filter((line) =>
    /^BREAKING[ -]CHANGE:\s*/i.test(line.trim())
  );
  breakingFooters.forEach((line) => {
    const content = line.replace(/^BREAKING[ -]CHANGE:\s*/i, '').trim();
    if (!content) {
      errors.push('BREAKING CHANGE 脚注必须写清楚不兼容的具体内容');
    }
  });

  return errors;
}

function readMessage(argv) {
  const arg = argv[2];
  if (!arg) {
    console.error('用法: node scripts/git-hooks/verify-commit-msg.js <message-file>');
    console.error('      node scripts/git-hooks/verify-commit-msg.js "<message>"');
    process.exit(1);
  }
  let target;
  try {
    target = resolveMessagePath(arg);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    console.error(`   仓库根目录: ${REPO_ROOT}`);
    process.exit(1);
  }

  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return fs.readFileSync(target, 'utf8');
    }
  } catch {
  }
  return arg;
}

function main() {
  const message = readMessage(process.argv);
  const errors = validate(message);

  if (errors.length === 0) {
    process.exit(0);
  }

  console.error('');
  console.error('❌ 提交信息不符合 Angular 提交规范：');
  errors.forEach((err) => console.error(`   · ${err}`));
  console.error('');
  console.error('规范速查：');
  console.error('   feat(updater): 增加应用更新卡片');
  console.error('   fix(main,renderer): 修正窗口尺寸同步');
  console.error('');
  console.error('   type：feat fix docs style refactor perf test build ci chore revert');
  console.error('   scope：小写模块名，可多选；拿不准就不写');
  console.error('   subject：祈使句，末尾不加句号，中文 ≤30 字');
  console.error('   破坏性变更：type 后加 ! 或补 BREAKING CHANGE: 脚注（两者二选一即可）');
  console.error('');
  console.error('完整规范见 AGENTS.md 第 2 节。');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { validate, TYPES };
