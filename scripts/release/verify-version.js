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

/**
 * 当前发布线 —— 1.3.x
 *
 * 1.2.x 从 1.2.0 起步，这期间累积了一个功能级提交（剪贴板链接识别与
 * 快捷方式新增），按 semver 规则它要求 minor 版本，minor 落在 1.3.0 ——
 * 所以换到 1.3.x。换线理由见 AGENTS.md 第 3.1 节。
 */
const RELEASE_LINE = { major: 1, minor: 3 };

/** 读取根 package.json 的 version */
function readVersion() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

/**
 * 校验版本号格式
 *
 * 只看「是不是三段纯数字」，不涉及发布线。发版脚本在 bump 之前会用它 ——
 * 换线的那一次发版，发版前的版本必然还在旧线上，拿发布线去卡它会把换线堵死。
 * 发布线由 bump 之后的完整校验把关。
 *
 * @param {string} version
 * @returns {string[]} 错误列表
 */
function validateFormat(version) {
  if (!version) {
    return ['package.json 里读不到 version'];
  }

  if (!VERSION_PATTERN.test(version)) {
    return [
      `版本号 "${version}" 不符合 MAJOR.MINOR.PATCH 格式（纯数字三段，不带 v 前缀）`,
    ];
  }

  return [];
}

/**
 * 校验版本号
 * @param {string} version
 * @param {string|null} tag 期望的 tag 名，传 null 则不校验 tag
 * @returns {string[]} 错误列表
 */
function validate(version, tag) {
  const errors = validateFormat(version);

  if (errors.length > 0) {
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

module.exports = { validate, validateFormat, readVersion, RELEASE_LINE };
