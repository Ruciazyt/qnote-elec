#!/usr/bin/env node
'use strict';

/**
 * 版本号校验 —— 统一 MAJOR.MINOR.PATCH，不带 v 前缀
 *
 * 检查 package.json 的 version 是否符合规范，并可顺带核对 git tag
 * 与版本号是否一致（发版时 tag 名必须等于版本号本身）。
 *
 *   node scripts/release/verify-version.js              # 只校验版本号格式
 *   node scripts/release/verify-version.js --tag 1.0.19 # 额外校验 tag 名
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');

// 解析成绝对路径再执行 —— 靠 PATH 查找的命令可以被同名可执行文件劫持，
// SonarCloud 会把这记成 S4036 安全漏洞（质量门禁里 Security Rating 直接掉到 E）
const GIT = resolveExe('git');

/** 版本号格式：三段纯数字 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** 当前发布线 —— 1.0.x。升到 1.1.0 属于新的次版本线，需要同步改这里并写明理由 */
const RELEASE_LINE = { major: 1, minor: 0 };

/** 读取根 package.json 的 version */
function readVersion() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

/**
 * 校验版本号
 * @param {string} version
 * @param {string|null} tag 期望的 tag 名，传 null 则不校验 tag
 * @returns {string[]} 错误列表
 */
function validate(version, tag) {
  const errors = [];

  if (!version) {
    return ['package.json 里读不到 version'];
  }

  if (!VERSION_PATTERN.test(version)) {
    errors.push(
      `版本号 "${version}" 不符合 MAJOR.MINOR.PATCH 格式（纯数字三段，不带 v 前缀）`
    );
    return errors;
  }

  const [major, minor] = version.split('.').map(Number);
  if (major !== RELEASE_LINE.major || minor !== RELEASE_LINE.minor) {
    errors.push(
      `版本号 "${version}" 不在当前发布线 ${RELEASE_LINE.major}.${RELEASE_LINE.minor}.x 上，` +
        `要换线请同步修改 scripts/release/verify-version.js 的 RELEASE_LINE`
    );
  }

  if (tag !== null && tag !== undefined) {
    if (tag !== version) {
      errors.push(
        `tag "${tag}" 与版本号 "${version}" 不一致 —— tag 名必须等于版本号本身，不要加 v 前缀`
      );
    }
  }

  return errors;
}

/** 读取当前 HEAD 上最新的版本号 tag（没有则返回 null） */
function latestTag() {
  try {
    const out = execFileSync(GIT, ['tag', '--list', '--sort=-v:refname'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const tags = out.split('\n').map((t) => t.trim()).filter(Boolean);
    return tags[0] || null;
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const version = readVersion();

  let tag = null;
  const tagIndex = args.indexOf('--tag');
  if (tagIndex >= 0) {
    tag = args[tagIndex + 1] || latestTag();
  }

  const errors = validate(version, tag);

  if (errors.length > 0) {
    console.error('');
    console.error('❌ 版本号不符合规范：');
    errors.forEach((err) => console.error(`   · ${err}`));
    console.error('');
    console.error('规范见 AGENTS.md 第 3 节。');
    process.exit(1);
  }

  console.log(`✅ 版本号规范：${version}${tag ? `（tag: ${tag}）` : ''}`);
}

if (require.main === module) {
  main();
}

module.exports = { validate, readVersion, RELEASE_LINE };
