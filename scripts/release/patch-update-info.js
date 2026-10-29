#!/usr/bin/env node
'use strict';

/**
 * 重算 latest.yml 里的安装包哈希
 *
 * ## 为什么需要这个脚本
 *
 * electron-builder 打出 NSIS 安装包后，会把该文件的 sha512 与 size 写进
 * latest.yml —— 自动更新（electron-updater）下载更新包后会拿这两个值校验，
 * 对不上就拒绝安装。
 *
 * 如果安装包在写出 latest.yml **之后**又被重新签名（文件字节变了），
 * latest.yml 里的哈希就失效了：自动更新会报哈希不匹配，更新装不上。
 *
 * SignPath 的签名正好发生在这个时间点之后（签名在 CI 的构建之后执行），
 * 所以签完必须跑一次这个脚本，把哈希重算成签名后文件的值。
 *
 *   node scripts/release/patch-update-info.js [输出目录]
 *
 * 默认输出目录为 dist_electron。只改 sha512 与 size 两个字段，
 * version / path / releaseDate 原样保留。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');

/** 读文件并按 UTF-8 解码 */
function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

/** 计算文件的 sha512（Base64，electron-updater 用的就是 base64 不是 hex） */
function sha512Base64(file) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(file));
  return hash.digest('base64');
}

/**
 * 从 latest.yml 里取出安装包文件名
 *
 * 取顶层 `path:` 字段 —— electron-builder 写 NSIS 更新信息时，
 * 顶层 path 与 files[0].url 指向同一个文件。
 *
 * 空白一律用 [ \t] 而不是 \s：\s 会连换行一起吃掉，
 * 配合多行正则（/m）会让引擎在每个行首反复回溯，复杂度退化成平方级
 * （SonarCloud S5852 判为安全漏洞）。yaml 的行内缩进本来也只有空格与制表符。
 *
 * @param {string} text
 * @returns {string|null}
 */
function parseInstallerPath(text) {
  const match = text.match(/^path:[ \t]*(\S.*)$/m);
  return match ? match[1].trim() : null;
}

/** 统计 yaml 里 sha512 / size 字段各出现多少次 */
function countFields(text) {
  const sha512Count = (text.match(/^[ \t]*sha512:[ \t]*/gm) || []).length;
  const sizeCount = (text.match(/^[ \t]*size:[ \t]*/gm) || []).length;
  return { sha512Count, sizeCount };
}

/**
 * 替换字段值，冒号后的原始空白原样保留
 *
 * 正则只负责把「字段名」和「冒号及其后内容」分开，具体取值交给这里处理 ——
 * 值里可能有空格，交给正则去匹配反而容易写出回溯代价高的写法。
 *
 * @param {string} head 字段名部分（缩进 + 字段名）
 * @param {string} tail 冒号及其后内容
 * @param {string} value 新值
 * @returns {string}
 */
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

  const { sha512Count, sizeCount } = countFields(original);
  if (sha512Count === 0) {
    console.error('❌ latest.yml 里没有 sha512 字段，不做改动。');
    process.exit(1);
  }
  if (sha512Count > 1 && sizeCount > 1) {
    // NSIS 产物只有一个更新文件。多条记录说明格式变了，硬改容易改错。
    console.error(
      `❌ latest.yml 里有 ${sha512Count} 条 sha512 记录，` +
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
