#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PROPERTIES = path.join(ROOT, 'sonar-project.properties');

const version = require(path.join(ROOT, 'package.json')).version;
const current = fs.readFileSync(PROPERTIES, 'utf8');
const eol = current.includes('\r\n') ? '\r\n' : '\n';
const kept = current
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('sonar.projectVersion='));
while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
const next = kept.join(eol) + eol + 'sonar.projectVersion=' + version + eol;

fs.writeFileSync(PROPERTIES, next, 'utf8');
console.log('sonar.projectVersion=' + version);
console.log('::notice title=SonarCloud version::sonar.projectVersion=' + version);
