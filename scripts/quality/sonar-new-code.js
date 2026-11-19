#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
function trimTrailingSlash(url) {
    let end = url.length;
    while (end > 0 && url[end - 1] === '/') end--;
    return url.slice(0, end);
}

const HOST_URL = trimTrailingSlash(process.env.SONAR_HOST_URL || 'https://sonarcloud.io');
const PROJECT_KEY = process.env.SONAR_PROJECT_KEY || 'Ruciazyt_qnote-elec';
const TOKEN_FILE = path.join(ROOT, '.data', 'sonar', 'token');
const DESIRED_TYPE = (process.env.SONAR_NEW_CODE_TYPE || 'previous_version').trim();

function readToken() {
    const fromEnv = (process.env.SONAR_TOKEN || '').trim();
    if (fromEnv) return fromEnv;
    try {
        return fs
            .readFileSync(TOKEN_FILE, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line && !line.startsWith('#')) || '';
    } catch {
        return '';
    }
}

function escapeAnnotation(text) {
    return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function note(level, title, text) {
    console.log('::' + level + ' title=' + escapeAnnotation(title) + '::' + escapeAnnotation(text));
}

async function api(pathname, params = {}, method = 'GET') {
    const url = new URL(HOST_URL + pathname);
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
    }
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: 'Bearer ' + readToken(),
            Accept: 'application/json',
        },
    });
    const body = await res.text();
    if (!res.ok) {
        throw new Error(method + ' ' + url.pathname + ' 返回 ' + res.status + '：' + body.slice(0, 300));
    }
    return body ? JSON.parse(body) : {};
}

function desiredSettings() {
    if (DESIRED_TYPE === 'previous_version') {
        return {
            'sonar.leak.period': 'previous_version',
            'sonar.leak.period.type': 'previous_version',
        };
    }
    const days = Number(DESIRED_TYPE);
    if (!Number.isFinite(days) || days <= 0) {
        throw new Error('SONAR_NEW_CODE_TYPE 只接受 previous_version 或天数，收到：' + DESIRED_TYPE);
    }
    return {
        'sonar.leak.period': String(days),
        'sonar.leak.period.type': 'days',
    };
}

async function main() {
    const token = readToken();
    if (!token) {
        note('notice', 'SonarCloud new code', '没有令牌，跳过新代码周期设置');
        return;
    }

    let current;
    try {
        const data = await api('/api/settings/values', {
            component: PROJECT_KEY,
            keys: 'sonar.leak.period,sonar.leak.period.type',
        });
        current = data.settings || {};
    } catch (error) {
        note('error', 'SonarCloud new code', '读取当前新代码周期失败：' + error.message);
        return;
    }

    const currentType = current['sonar.leak.period.type'] || 'unknown';
    const currentValue = current['sonar.leak.period'] || 'unknown';
    note('notice', 'SonarCloud new code', '当前新代码周期：type=' + currentType + ' value=' + currentValue);

    const wanted = desiredSettings();
    if (currentType === wanted['sonar.leak.period.type'] && currentValue === wanted['sonar.leak.period']) {
        note('notice', 'SonarCloud new code', '已经是目标设置，无需修改');
        return;
    }

    for (const [key, value] of Object.entries(wanted)) {
        try {
            await api('/api/settings/set', { component: PROJECT_KEY, key, value }, 'POST');
        } catch (error) {
            note('error', 'SonarCloud new code', '设置 ' + key + ' 失败：' + error.message);
            return;
        }
    }
    note('notice', 'SonarCloud new code', '已把新代码周期改成 type=' + wanted['sonar.leak.period.type'] + ' value=' + wanted['sonar.leak.period']);
    await new Promise((resolve) => setTimeout(resolve, 15000));
}

main().catch((error) => {
    note('error', 'SonarCloud new code', '执行失败：' + error.message);
});
