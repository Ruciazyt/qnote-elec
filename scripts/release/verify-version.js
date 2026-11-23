#!/usr/bin/env node
'use strict';


const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');

const GIT = resolveExe('git');

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const RELEASE_LINE = { major: 2, minor: 2 };

function readVersion() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

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

  console.log(`✅ 版本号规范：${version}${tag ? '（tag: ' + tag + '）' : ''}`);
}

if (require.main === module) {
  main();
}

module.exports = { validate, validateFormat, readVersion, RELEASE_LINE };
