#!/usr/bin/env node
'use strict';


const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function sha512Base64(file) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(file));
  return hash.digest('base64');
}

function parseInstallerPath(text) {
  const match = text.match(/^path:[ \t]*(\S.*)$/m);
  return match ? match[1].trim() : null;
}

function countFields(text) {
  const lines = text.split('\n');
  let fileCount = 0;
  let sha512Count = 0;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('- url:')) fileCount++;
    if (trimmed.startsWith('sha512:')) sha512Count++;
  }
  return { fileCount, sha512Count };
}

function withValue(head, tail, value) {
  const rest = tail.slice(1);
  const blank = rest.slice(0, rest.length - rest.trimStart().length);
  return `${head}:${blank}${value}`;
}

function main() {
  const args = process.argv.slice(2);
  const outputArg = args.find((a) => !a.startsWith('--'));
  const outputDir = outputArg
    ? path.resolve(ROOT, outputArg)
    : path.join(ROOT, 'dist_electron');

  const updateInfoPath = path.join(outputDir, 'latest.yml');
  if (!fs.existsSync(updateInfoPath)) {
    console.error(`❌ 找不到 ${updateInfoPath}`);
    console.error('   先跑一次打包（pnpm run build:app）再执行。');
    process.exit(1);
  }

  const original = readText(updateInfoPath);
  const installerName = parseInstallerPath(original);
  if (!installerName) {
    console.error('❌ latest.yml 里读不到 path 字段，文件格式与预期不符。');
    process.exit(1);
  }

  const installerPath = path.join(outputDir, installerName);
  if (!fs.existsSync(installerPath)) {
    console.error(`❌ latest.yml 指向的安装包不存在：${installerPath}`);
    console.error('   签名后如果改了文件名，记得同步改 latest.yml。');
    process.exit(1);
  }

  const { fileCount, sha512Count } = countFields(original);
  if (sha512Count === 0) {
    console.error('❌ latest.yml 里没有 sha512 字段，不做改动。');
    process.exit(1);
  }
  if (fileCount > 1) {
    console.error(
      `❌ latest.yml 里有 ${fileCount} 个更新文件，` +
        '当前脚本只支持单文件更新信息，不做改动。'
    );
    process.exit(1);
  }

  const newSha512 = sha512Base64(installerPath);
  const newSize = fs.statSync(installerPath).size;

  const patched = original
    .replace(/^([ \t]*sha512)(:[^\n]*)$/gm, (whole, head, tail) => withValue(head, tail, newSha512))
    .replace(/^([ \t]*size)(:[^\n]*)$/gm, (whole, head, tail) => withValue(head, tail, newSize));

  if (patched === original) {
    console.log('ℹ️ latest.yml 的哈希已经是当前值，无需改动。');
    return;
  }

  fs.writeFileSync(updateInfoPath, patched, 'utf8');

  console.log('✅ 已重算 latest.yml 的哈希');
  console.log(`   安装包   : ${installerName}`);
  console.log(`   size     : ${newSize}`);
  console.log(`   sha512   : ${newSha512}`);
  console.log('');
  console.log('   自动更新会拿这两个值校验下载到的安装包 —— 对不上就会拒绝安装。');
}

if (require.main === module) {
  main();
}

module.exports = { parseInstallerPath, sha512Base64 };
