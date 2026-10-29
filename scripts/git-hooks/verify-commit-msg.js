#!/usr/bin/env node
'use strict';

/**
 * 提交信息校验 —— Angular 提交规范
 *
 * 挂在 .githooks/commit-msg 上，提交时逐条检查；也可以单独跑：
 *   node scripts/git-hooks/verify-commit-msg.js "feat(updater): 增加应用更新卡片"
 *
 * 零依赖是刻意的选择。这个项目的 postinstall（electron-builder install-app-deps）
 * 在部分机器上本就会失败，再引入 husky / commitlint 只会让安装链路更脆。
 * 规则集中在这一个文件里，改规则就是改这里。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveExe } = require('../lib/resolve-exe');

/**
 * 仓库根目录 —— 工作区根
 *
 * git 传给 commit-msg 钩子的是 .git 目录下的临时文件（.git/COMMIT_EDITMSG），
 * 正常克隆时它就在工作区根之内。
 */
const REPO_ROOT = path.resolve(__dirname, '../..');

const GIT = resolveExe('git');

/**
 * git 目录 —— 提交信息文件实际所在的位置
 *
 * linked worktree 下 .git 是个文件，COMMIT_EDITMSG 落在主仓库的
 * .git/worktrees/<name>/ 里，在工作区根之外。只认工作区根会把
 * worktree 里的提交全部拦下来，所以两个范围都要认。
 */
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

/** target 是否落在 base 之内（含 base 自身） */
function isInside(base, target) {
  if (!base) return false;
  const rel = path.relative(base, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 把提交信息文件路径收进受信任的范围
 *
 * 两种用法都要过：git hook 传的是文件路径，pnpm run verify:commit 传的是
 * 提交信息本身。后者会被当成路径解析一次 —— 正常消息（"feat(x): …"）解析
 * 后仍在仓库内，不会被这里拦下。
 *
 * 不合法就抛错，由调用方统一处理：校验通过之前不碰文件系统，
 * 等于不允许读仓库外的任意文件（SonarCloud S8707 路径穿越）。
 */
function resolveMessagePath(arg) {
  const target = path.resolve(REPO_ROOT, arg);
  if (!isInside(REPO_ROOT, target) && !isInside(GIT_DIR, target)) {
    throw new Error(`提交信息文件必须位于仓库目录之内: ${arg}`);
  }
  return target;
}

/** Angular 规范允许的 type */
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

/** 首行（type + scope + subject）总长上限 */
const MAX_HEADER_LENGTH = 72;

/** subject 长度上限：中文按字算，英文按字符算 */
const MAX_SUBJECT_CJK = 30;
const MAX_SUBJECT_ASCII = 72;

/** 这些前缀是 git / 工具自动生成的，不按规范校验 */
const AUTO_PREFIXES = ['Merge ', 'Revert ', 'fixup!', 'squash!', 'amend!'];

/** scope 允许的字符：小写字母、数字、连字符、下划线、逗号、斜杠 */
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9\-_/,]*$/;

/** 统计 CJK 字符个数（用于区分中英文长度限制） */
function countCjk(text) {
  const matched = text.match(/[㐀-鿿豈-﫿]/g);
  return matched ? matched.length : 0;
}

/**
 * 校验一条提交信息
 * @param {string} message 完整提交信息（含正文与脚注）
 * @returns {string[]} 错误列表，空数组表示通过
 */
function validate(message) {
  const errors = [];
  const lines = message.split(/\r?\n/);
  const header = (lines[0] || '').trim();

  if (!header) {
    return ['提交信息不能为空'];
  }

  // 自动生成的提交（merge / revert / fixup）直接放行
  if (AUTO_PREFIXES.some((prefix) => header.startsWith(prefix))) {
    return [];
  }

  if (header.length > MAX_HEADER_LENGTH) {
    errors.push(
      `首行长度 ${header.length} 字符，超过 ${MAX_HEADER_LENGTH} 上限`
    );
  }

  // ---- 头部格式：type(scope): subject / type: subject / type(scope)!: subject
  const headerPattern = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?: (.+)$/;
  const matched = header.match(headerPattern);
  if (!matched) {
    errors.push(
      '头部格式不符合 <type>(<scope>): <subject>，例如 feat(updater): 增加应用更新卡片'
    );
    return errors;
  }

  const [, rawType, scope, breaking, subject] = matched;

  // ---- type
  if (!TYPES.has(rawType)) {
    errors.push(
      `type "${rawType}" 不在允许列表内，可用值：${[...TYPES].join(' / ')}`
    );
  }

  // ---- scope
  if (scope !== undefined) {
    if (!scope) {
      errors.push('scope 不能为空，括号里要么写模块名，要么整个括号省略');
    } else if (!SCOPE_PATTERN.test(scope)) {
      errors.push(
        `scope "${scope}" 含非法字符，只能用小写字母、数字、- _ , /`
      );
    }
  }

  // ---- subject
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

  // ---- 脚注：BREAKING CHANGE 必须成对且有内容
  //
  // type 后的 ! 与 BREAKING CHANGE 脚注是**二选一**的破坏性变更标记
  // （Conventional Commits 规范），两者并存也合法，所以不强制要求配对。
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

/** 从命令行参数或 hook 传入的路径读取提交信息 */
function readMessage(argv) {
  const arg = argv[2];
  if (!arg) {
    console.error('用法: node scripts/git-hooks/verify-commit-msg.js <message-file>');
    console.error('      node scripts/git-hooks/verify-commit-msg.js "<message>"');
    process.exit(1);
  }
  // 参数有两种用法：git hook 传的是提交信息文件路径，
  // pnpm run verify:commit 传的是提交信息本身。
  // 两种都先解析成绝对路径并确认落在受信任的范围之内 ——
  // 不校验就读文件，等于允许读仓库外的任意文件（SonarCloud S8707 路径穿越）。
  // 判定方式与主进程 src/main/core/noteStore.ts 的 resolveSafe 一致。
  let target;
  try {
    target = resolveMessagePath(arg);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    console.error(`   仓库根目录: ${REPO_ROOT}`);
    process.exit(1);
  }

  // hook 传进来的是文件路径；直接传字符串时原样使用
  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return fs.readFileSync(target, 'utf8');
    }
  } catch {
    /* 当成普通字符串处理 */
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
