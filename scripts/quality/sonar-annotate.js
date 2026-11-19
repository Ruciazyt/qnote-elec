#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const REPORT = path.join(ROOT, '.data', 'sonar', 'sonar-issues.json');
const BLOCK_TYPES = ['BUG', 'VULNERABILITY'];
const LIMIT = 40;

function issueTypes(issue) {
  if (Array.isArray(issue.impactSoftwareQualities) && issue.impactSoftwareQualities.length) {
    return issue.impactSoftwareQualities;
  }
  return issue.type ? [issue.type] : [];
}

function location(issue) {
  const component = String(issue.component || '');
  const file = component.includes(':') ? component.slice(component.indexOf(':') + 1) : component;
  return issue.line ? `${file}:${issue.line}` : file;
}

function escapeAnnotation(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  } catch {
    console.log('::warning::SonarCloud report is not readable');
    return;
  }

  const gate = data.gate;
  if (gate && gate.status && gate.status !== 'OK') {
    const failed = (gate.conditions || []).filter((condition) => condition.status === 'ERROR');
    console.log(
      '::error title=SonarCloud quality gate ' + escapeAnnotation(gate.status) +
      '::' + escapeAnnotation(
        failed.length + ' condition(s) failed; new code period=' + (gate.newCodePeriod || 'unknown')
      )
    );
    for (const condition of failed) {
      const title = escapeAnnotation('gate: ' + condition.metricKey);
      const body = escapeAnnotation(
        'actual ' + condition.actualValue + ', requires ' + condition.comparator + ' ' + condition.errorThreshold
      );
      console.log('::error title=' + title + '::' + body);
    }
  }

  const newCode = data.newCode || {};
  const measures = Object.entries(newCode).filter(([, value]) => value !== undefined && value !== null);
  if (measures.length) {
    console.log(
      '::notice title=SonarCloud new code::' +
        escapeAnnotation(measures.map(([key, value]) => key + '=' + value).join(' '))
    );
  }

  const analyses = Array.isArray(data.analyses) ? data.analyses : [];
  if (analyses.length) {
    console.log(
      '::notice title=SonarCloud versions::' +
        escapeAnnotation(
          analyses.slice(0, 8).map((a) => (a.version || 'none') + '@' + a.revision).join(' ')
        )
    );
  }

  const issues = Array.isArray(data.issues) ? data.issues : [];
  const blocking = issues.filter((issue) => issueTypes(issue).some((type) => BLOCK_TYPES.includes(type)));

  if (!blocking.length) {
    console.log('::notice::No BUG or VULNERABILITY issue found in the SonarCloud report');
    return;
  }

  const count = typeof data.blockingCount === 'number' ? data.blockingCount : blocking.length;
  console.log(
    `::error title=SonarCloud gate blocked (blockingCount=${count})::${blocking.length} issue(s) of type BUG or VULNERABILITY are still open`
  );

  for (const issue of blocking.slice(0, LIMIT)) {
    const title = escapeAnnotation(`${issue.severity || 'UNKNOWN'} ${issue.rule || 'UNKNOWN'}`);
    const body = escapeAnnotation(
      `${location(issue)} — ${String(issue.message || '').replace(/\s+/g, ' ').slice(0, 300)}`
    );
    console.log(`::error title=${title}::${body}`);
  }

  if (blocking.length > LIMIT) {
    console.log(`::warning::${blocking.length - LIMIT} more issue(s) are not listed here`);
  }
}

main();
