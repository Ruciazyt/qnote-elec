#!/usr/bin/env node
'use strict';


const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveExe } = require('../lib/resolve-exe');

const ROOT = path.resolve(__dirname, '../..');
const IS_WIN = process.platform === 'win32';

function scannerCandidates() {
    const names = IS_WIN ? ['sonar-scanner.bat', 'sonar-scanner.cmd', 'sonar-scanner'] : ['sonar-scanner'];
    const found = [];
    for (const name of names) {
        const resolved = resolveExe(name);
        if (resolved !== name && fs.existsSync(resolved)) {
            found.push(resolved);
        }
    }
    const home = process.env.SONAR_SCANNER_HOME;
    if (home) {
        const bin = path.join(home, 'bin', IS_WIN ? 'sonar-scanner.bat' : 'sonar-scanner');
        if (fs.existsSync(bin)) found.push(bin);
    }
    if (!IS_WIN) {
        for (const candidate of ['/usr/local/bin/sonar-scanner', '/opt/sonar-scanner/bin/sonar-scanner']) {
            if (fs.existsSync(candidate)) found.push(candidate);
        }
    }
    return found;
}

function javaAvailable() {
    if (process.env.JAVA_HOME) {
        const exe = path.join(process.env.JAVA_HOME, 'bin', IS_WIN ? 'java.exe' : 'java');
        if (fs.existsSync(exe)) return exe;
    }
    const resolved = resolveExe('java');
    if (resolved !== 'java' && fs.existsSync(resolved)) return resolved;
    return null;
}

function main() {
    const token = (process.env.SONAR_TOKEN || '').trim();
    if (!token) {
        const tokenFile = path.join(ROOT, '.data', 'sonar', 'token');
        try {
            process.env.SONAR_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
        } catch {
        }
    }
    if (!process.env.SONAR_TOKEN) {
        console.error('');
        console.error('❌ 没有 SonarCloud 令牌。');
        console.error('');
        console.error('   令牌来源（任选其一）：');
        console.error('   · 环境变量 SONAR_TOKEN');
        console.error('   · 文件 .data/sonar/token（该目录已被 gitignore）');
        console.error('');
        console.error('   生成方式见 docs/SONAR.md。');
        console.error('');
        process.exit(1);
    }

    const java = javaAvailable();
    if (!java) {
        console.error('');
        console.error('❌ 没找到 Java —— sonar-scanner CLI 需要 JDK 17 或更高。');
        console.error('');
        console.error('   装一个 JDK 17+ 并保证 java 在 PATH 里（或设 JAVA_HOME），再重试。');
        console.error('');
        console.error('   不想装 JDK 也可以：');
        console.error('   · 门禁清单用 `pnpm run sonar:issues`（只查 SonarCloud 上的结果，不需要 Java）');
        console.error('   · 完整扫描交给 CI（推 master 时自动跑）');
        console.error('');
        process.exit(1);
    }

    const scanners = scannerCandidates();
    if (!scanners.length) {
        console.error('');
        console.error('❌ 没找到 sonar-scanner CLI。');
        console.error('');
        console.error('   下载：https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/');
        console.error('   解压后把它的 bin 目录加进 PATH，或设 SONAR_SCANNER_HOME 指向解压目录。');
        console.error('');
        process.exit(1);
    }

    const scanner = scanners[0];
    const extraArgs = (process.env.SONAR_SCANNER_ARGS || '')
        .split(/\s+/)
        .filter(Boolean);

    console.log(`🔍 使用扫描器：${scanner}`);
    console.log(`   Java：${java}`);
    console.log('   分析范围与项目配置见 sonar-project.properties');
    console.log('');

    try {
        execFileSync(scanner, extraArgs, {
            stdio: 'inherit',
            cwd: ROOT,
            shell: IS_WIN,
            env: {
                ...process.env,
                SONAR_TOKEN: process.env.SONAR_TOKEN,
                JAVA_HOME: process.env.JAVA_HOME || path.dirname(path.dirname(java)),
            },
        });
        console.log('');
        console.log('✅ 扫描完成。');
        console.log('   接着跑 `pnpm run sonar:issues` 看清单。');
    } catch (error) {
        console.error('');
        console.error(`❌ 扫描失败（退出码 ${error.status ?? '未知'}）`);
        console.error('');
        console.error('   常见原因：');
        console.error('   · 令牌无效或没有该项目的分析权限');
        console.error('   · 项目 key 不对（看 sonar-project.properties 的 sonar.projectKey）');
        console.error('   · 网络到不了 sonarcloud.io');
        console.error('');
        process.exit(1);
    }
}

main();
