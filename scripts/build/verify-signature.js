'use strict';

/**
 * 打包产物的代码签名体检
 *
 * ## 为什么需要这个脚本
 *
 * 「文件带了签名」和「签名有效」是两件事，混在一起就会得出错误结论：
 *
 *   - 自签名证书（CN=自己，Issuer=自己）能证明文件没被篡改，但证书链在系统里
 *     找不到信任根。Windows 的判定是 UnknownError —— SmartScreen 照样弹
 *     「未知发布者」，企业 EDR 照样按「签名无效」拦。
 *   - 有些扫描器对「有签名但链不可信」的判定比「完全没签名」更严：
 *     未签名只算「未知」，签名了却链不可信会同时命中「签名被伪造/剥离」
 *     这类启发式规则，结论直接升级成高危。
 *
 * 所以发版前要分三层看清：
 *
 *   1. 哪些文件带了签名 —— 读 PE 头的数据目录表，第 4 项是 Certificate Table
 *   2. 这些签名的证书链系统认不认 —— Get-AuthenticodeSignature
 *   3. 产物的 SHA256 —— 企业白名单、误报申诉、用户核对都要用
 *
 * 用法：
 *
 *   node scripts/build/verify-signature.js [输出目录]
 *
 * 默认只报告、不失败 —— 签名不合格不应该把打包流程卡死（那会让「先发布、
 * 后换证书」这条路走不通）。要卡门禁就加 --strict，此时只要有文件带签名
 * 但证书链不被系统信任，就以退出码 1 结束。
 *
 * 报告里会顺带在输出目录写一份 SHA256SUMS.txt，格式与 sha256sum 一致，
 * 可以直接 `sha256sum -c SHA256SUMS.txt` 校验。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** 会参与执行的可执行文件后缀 —— 这些是安全扫描重点盯的对象 */
const PE_EXTENSIONS = ['.exe', '.dll', '.node'];

/** 一次扫描最多交给 PowerShell 多少个文件做证书链校验 */
const TRUST_CHECK_LIMIT = 40;

// ---------------------------------------------------------------------------
// PE 头解析：判断文件里有没有 Authenticode 签名
// ---------------------------------------------------------------------------

/**
 * 读 PE 头的 Certificate Table，判断文件是否带 Authenticode 签名
 *
 * 数据目录表第 4 项（索引 4）是 Certificate Table。它的 VirtualAddress
 * 字段按 PE 规范存的是**文件偏移**（不是 RVA），Size 大于 0 即为带签名。
 *
 * @param {string} file
 * @returns {boolean}
 */
function hasAuthenticodeSignature(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const read = fs.readSync(fd, head, 0, 4096, 0);
    if (read < 64) return false;
    if (head.readUInt16LE(0) !== 0x5a4d) return false; // 'MZ'

    const peOffset = head.readUInt32LE(0x3c);
    // PE 头 + COFF 头 + 可选头 + 5 个目录项，缺一不可
    if (peOffset + 24 + 176 > read) return false;
    if (head.readUInt32LE(peOffset) !== 0x00004550) return false; // 'PE\0\0'

    const sizeOfOptionalHeader = head.readUInt16LE(peOffset + 20);
    const optOffset = peOffset + 24;
    if (sizeOfOptionalHeader < 68) return false;
    if (optOffset + sizeOfOptionalHeader > read) return false;

    const magic = head.readUInt16LE(optOffset);
    let dirOffset;
    if (magic === 0x20b) dirOffset = optOffset + 112; // PE32+
    else if (magic === 0x10b) dirOffset = optOffset + 96; // PE32
    else return false;

    const certDirOffset = dirOffset + 4 * 8;
    if (certDirOffset + 8 > read) return false;

    return head.readUInt32LE(certDirOffset + 4) > 0;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 关闭失败不影响结论 */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 证书链校验：借 PowerShell 的 Get-AuthenticodeSignature
// ---------------------------------------------------------------------------

/**
 * 取一批文件的签名状态（证书链是否被系统信任）
 *
 * Node 读不了 Windows 证书链，只能借 PowerShell。脚本内容保持纯 ASCII，
 * 输出里的 StatusMessage 可能被系统本地化成中文 —— 所以先把控制台输出
 * 编码设为 UTF8，避免 Node 按 utf8 解码时出现乱码。
 *
 * @param {string[]} files
 * @returns {Array<Object>}
 */
function checkTrustWithPowerShell(files) {
  if (process.platform !== 'win32' || files.length === 0) return [];

  const ps = resolveExe('powershell');
  if (!fs.existsSync(ps)) return [];

  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "SilentlyContinue"',
    '$paths = ConvertFrom-Json -InputObject $env:QNOTE_SIG_TARGETS',
    '$result = @()',
    'foreach ($p in $paths) {',
    '  $s = Get-AuthenticodeSignature -LiteralPath $p',
    '  $subject = ""',
    '  $issuer = ""',
    '  $notAfter = ""',
    '  $timestamp = ""',
    '  if ($s.SignerCertificate -ne $null) {',
    '    $subject = [string]$s.SignerCertificate.Subject',
    '    $issuer = [string]$s.SignerCertificate.Issuer',
    '    $notAfter = $s.SignerCertificate.NotAfter.ToString("yyyy-MM-dd")',
    '  }',
    '  if ($s.TimeStamperCertificate -ne $null) {',
    '    $timestamp = [string]$s.TimeStamperCertificate.Subject',
    '  }',
    '  $result += [PSCustomObject]@{',
    '    Path = $p',
    '    Status = [string]$s.Status',
    '    StatusMessage = [string]$s.StatusMessage',
    '    Subject = $subject',
    '    Issuer = $issuer',
    '    NotAfter = $notAfter',
    '    TimestampSubject = $timestamp',
    '  }',
    '}',
    '$result | ConvertTo-Json -Compress -Depth 3',
  ].join('\n');

  const tmpScript = path.join(os.tmpdir(), `qnote-sig-${process.pid}.ps1`);
  try {
    fs.writeFileSync(tmpScript, script, 'ascii');
    const stdout = execFileSync(
      ps,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpScript],
      {
        encoding: 'utf8',
        env: { ...process.env, QNOTE_SIG_TARGETS: JSON.stringify(files) },
        maxBuffer: 32 * 1024 * 1024,
      }
    );
    const text = String(stdout || '').trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // 证书链校验失败不算致命：报告里降级成「未校验」
    return [];
  } finally {
    try {
      fs.unlinkSync(tmpScript);
    } catch {
      /* 临时文件删不掉也不影响构建 */
    }
  }
}

// ---------------------------------------------------------------------------
// 产物收集
// ---------------------------------------------------------------------------

/**
 * 递归收集目录下的可执行文件
 *
 * @param {string} dir
 * @param {string[]} out
 */
function collectPeFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPeFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (PE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

/**
 * 收集打包产物：安装包 / 便携版压缩包 / 解包目录里的可执行文件
 *
 * @param {string} outputDir
 */
function collectArtifacts(outputDir) {
  const installers = [];
  const archives = [];
  let entries = [];
  try {
    entries = fs.readdirSync(outputDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(outputDir, entry.name);
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.exe')) installers.push(full);
    else if (lower.endsWith('.zip')) archives.push(full);
  }

  const appFiles = [];
  const unpackedDir = path.join(outputDir, 'win-unpacked');
  if (fs.existsSync(unpackedDir)) {
    collectPeFiles(unpackedDir, appFiles);
  }

  return { installers, archives, appFiles, unpackedDir };
}

/** 计算文件的 SHA256 */
function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 相对仓库根的展示路径 */
function rel(file) {
  const p = path.relative(ROOT, file);
  return p.startsWith('..') ? file : p;
}

/**
 * 打印单个文件的签名信息
 */
function printFileInfo(file, trustMap) {
  const stat = fs.statSync(file);
  console.log(`\n【${path.basename(file)}】`);
  console.log(`   路径       : ${rel(file)}`);
  console.log(`   大小       : ${formatSize(stat.size)}`);
  console.log(`   SHA256     : ${sha256(file)}`);

  const signed = hasAuthenticodeSignature(file);
  if (!signed) {
    console.log('   签名       : 无（文件里没有 PE 证书表）');
    return false;
  }
  console.log('   签名       : 有');

  const trust = trustMap.get(file);
  if (!trust) {
    console.log('   证书链     : 未校验（PowerShell 不可用或文件过多）');
    return true;
  }
  console.log(`   证书链     : ${trust.Status}${trust.StatusMessage ? ` — ${trust.StatusMessage}` : ''}`);
  if (trust.Subject) console.log(`   发布者     : ${trust.Subject}`);
  if (trust.Issuer) console.log(`   签发者     : ${trust.Issuer}`);
  if (trust.NotAfter) console.log(`   证书有效期 : 至 ${trust.NotAfter}`);
  if (trust.TimestampSubject) console.log(`   时间戳     : ${trust.TimestampSubject}`);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const outputArg = args.find((a) => !a.startsWith('--'));
  const outputDir = outputArg
    ? path.resolve(ROOT, outputArg)
    : path.join(ROOT, 'dist_electron');

  if (!fs.existsSync(outputDir)) {
    console.error(`❌ 找不到产物目录：${outputDir}`);
    console.error('   先跑一次打包（pnpm run build:app）再体检。');
    process.exit(1);
  }

  const { installers, archives, appFiles, unpackedDir } = collectArtifacts(outputDir);

  console.log('='.repeat(72));
  console.log('🔍 代码签名体检');
  console.log(`   产物目录：${rel(outputDir)}`);
  console.log('='.repeat(72));

  if (installers.length === 0 && appFiles.length === 0) {
    console.log('\n没有找到任何可执行文件产物，跳过体检。');
    return;
  }

  // 主程序 exe 与安装包单独展开细说
  const productName = PKG.build?.productName || 'QNote';
  const mainExe = path.join(unpackedDir, `${productName}.exe`);
  const keyFiles = [];
  if (fs.existsSync(mainExe)) keyFiles.push(mainExe);
  for (const f of installers) keyFiles.push(f);

  // 所有带签名的文件都过一遍证书链（数量通常很小）
  const signedAppFiles = appFiles.filter((f) => hasAuthenticodeSignature(f));
  const trustTargets = [...new Set([...keyFiles, ...signedAppFiles])].slice(0, TRUST_CHECK_LIMIT);

  const trustList = checkTrustWithPowerShell(trustTargets);
  const trustMap = new Map(trustList.map((t) => [t.Path, t]));

  // ---- 安装包 ----
  for (const file of installers) {
    printFileInfo(file, trustMap);
  }

  // ---- 主程序 ----
  if (fs.existsSync(mainExe)) {
    printFileInfo(mainExe, trustMap);
  }

  // ---- 解包目录里的其它可执行文件 ----
  const otherAppFiles = appFiles.filter((f) => f !== mainExe);
  const unsigned = otherAppFiles.filter((f) => !hasAuthenticodeSignature(f));
  const signedOthers = otherAppFiles.filter(
    (f) => f !== mainExe && hasAuthenticodeSignature(f)
  );

  if (signedOthers.length > 0) {
    console.log(`\n【解包目录里另外 ${signedOthers.length} 个带签名的文件】`);
    for (const f of signedOthers.slice(0, 10)) {
      const t = trustMap.get(f);
      console.log(
        `   ${t ? `链状态 ${t.Status}` : '未校验'} · ${rel(f)}`
      );
    }
    if (signedOthers.length > 10) {
      console.log(`   …… 其余 ${signedOthers.length - 10} 个略`);
    }
  }

  if (unsigned.length > 0) {
    console.log(`\n【解包目录里 ${unsigned.length} 个未签名的可执行文件】`);
    console.log('   （原生模块、DLL 这类文件 electron-builder 默认不签）');
    for (const f of unsigned.slice(0, 20)) {
      console.log(`   - ${rel(f)}`);
    }
    if (unsigned.length > 20) {
      console.log(`   …… 其余 ${unsigned.length - 20} 个略`);
    }
  }

  // ---- SHA256 清单 ----
  const hashTargets = [...installers, ...archives];
  if (hashTargets.length > 0) {
    const lines = hashTargets.map((f) => `${sha256(f)}  ${path.basename(f)}`);
    const sumsPath = path.join(outputDir, 'SHA256SUMS.txt');
    fs.writeFileSync(sumsPath, lines.join('\n') + '\n', 'utf8');
    console.log(`\n【SHA256 清单】已写入 ${rel(sumsPath)}`);
    for (const line of lines) console.log(`   ${line}`);
  }

  // ---- 结论 ----
  const allSigned = [
    ...installers,
    ...(fs.existsSync(mainExe) ? [mainExe] : []),
  ];
  const trusted = allSigned.filter((f) => trustMap.get(f)?.Status === 'Valid');
  const signedButUntrusted = allSigned.filter((f) => {
    const t = trustMap.get(f);
    return t && t.Status !== 'Valid';
  });

  console.log('\n' + '='.repeat(72));
  console.log('结论');
  console.log('='.repeat(72));
  if (allSigned.length === 0) {
    console.log('⚠️  安装包与主程序都没有签名 —— SmartScreen 与企业 EDR 都会拦截。');
  } else if (trusted.length === allSigned.length) {
    console.log('✅  安装包与主程序的签名证书链有效，系统认这个发布者。');
  } else if (signedButUntrusted.length > 0) {
    console.log('⚠️  有签名，但证书链不被系统信任（多半是自签名证书）。');
    console.log('    自签名只能证明「文件没被改过」，不能证明「这个发布者是谁」——');
    console.log('    SmartScreen 仍会显示「未知发布者」，企业 EDR 会按「签名无效」拦截。');
    console.log('    对外分发要过扫描，需要换成公共 CA 签发的代码签名证书（OV / EV）。');
  }
  if (unsigned.length > 0) {
    console.log(`ℹ️  解包目录里还有 ${unsigned.length} 个未签名的可执行文件（原生模块 / DLL）。`);
  }
  console.log('');

  if (strict && signedButUntrusted.length > 0) {
    console.error('❌ --strict：存在证书链不被系统信任的签名产物。');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { hasAuthenticodeSignature, collectPeFiles };
