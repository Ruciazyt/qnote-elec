'use strict';


const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const PE_EXTENSIONS = ['.exe', '.dll', '.node'];

const TRUST_CHECK_LIMIT = 40;


function hasAuthenticodeSignature(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const read = fs.readSync(fd, head, 0, 4096, 0);
    if (read < 64) return false;
    if (head.readUInt16LE(0) !== 0x5a4d) return false;

    const peOffset = head.readUInt32LE(0x3c);
    if (peOffset + 24 + 176 > read) return false;
    if (head.readUInt32LE(peOffset) !== 0x00004550) return false;

    const sizeOfOptionalHeader = head.readUInt16LE(peOffset + 20);
    const optOffset = peOffset + 24;
    if (sizeOfOptionalHeader < 68) return false;
    if (optOffset + sizeOfOptionalHeader > read) return false;

    const magic = head.readUInt16LE(optOffset);
    let dirOffset;
    if (magic === 0x20b) dirOffset = optOffset + 112;
    else if (magic === 0x10b) dirOffset = optOffset + 96;
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
      }
    }
  }
}


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
    return [];
  } finally {
    try {
      fs.unlinkSync(tmpScript);
    } catch {
    }
  }
}


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

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}


function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function rel(file) {
  const p = path.relative(ROOT, file);
  return p.startsWith('..') ? file : p;
}

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
  console.log(`   证书链     : ${trust.Status}${trust.StatusMessage ? ' — ' + trust.StatusMessage : ''}`);
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

  const productName = PKG.build?.productName || 'QNote';
  const mainExe = path.join(unpackedDir, `${productName}.exe`);
  const keyFiles = [];
  if (fs.existsSync(mainExe)) keyFiles.push(mainExe);
  for (const f of installers) keyFiles.push(f);

  const signedAppFiles = appFiles.filter((f) => hasAuthenticodeSignature(f));
  const trustTargets = [...new Set([...keyFiles, ...signedAppFiles])].slice(0, TRUST_CHECK_LIMIT);

  const trustList = checkTrustWithPowerShell(trustTargets);
  const trustMap = new Map(trustList.map((t) => [t.Path, t]));

  for (const file of installers) {
    printFileInfo(file, trustMap);
  }

  if (fs.existsSync(mainExe)) {
    printFileInfo(mainExe, trustMap);
  }

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
        `   ${t ? '链状态 ' + t.Status : '未校验'} · ${rel(f)}`
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

  const hashTargets = [...installers, ...archives];
  if (hashTargets.length > 0) {
    const lines = hashTargets.map((f) => `${sha256(f)}  ${path.basename(f)}`);
    const sumsPath = path.join(outputDir, 'SHA256SUMS.txt');
    fs.writeFileSync(sumsPath, lines.join('\n') + '\n', 'utf8');
    console.log(`\n【SHA256 清单】已写入 ${rel(sumsPath)}`);
    for (const line of lines) console.log(`   ${line}`);
  }

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
