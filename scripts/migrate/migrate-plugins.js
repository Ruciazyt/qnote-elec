#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'dist');

const LEGACY_MODULE = path.join(DIST, 'main', 'core', 'plugin', 'migration', 'legacyMigration.js');
const MIGRATION_MODULE = path.join(DIST, 'database', 'migrations', 'index.js');
const DATABASE_MODULE = path.join(DIST, 'database', 'index.js');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { userData: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--user-data') opts.userData = argv[++i] || '';
  }
  return opts;
}

for (const file of [LEGACY_MODULE, MIGRATION_MODULE, DATABASE_MODULE]) {
  if (!fs.existsSync(file)) {
    fail('找不到主进程编译产物：' + path.relative(ROOT, file) + '，先跑 pnpm run build:main');
  }
}

const opts = parseArgs(process.argv.slice(2));
const hostVersion = require(path.join(ROOT, 'package.json')).version;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        getPath: () => path.join(ROOT, '.data'),
        getAppPath: () => ROOT,
        getName: () => 'QNote',
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { migrateRun } = require(MIGRATION_MODULE);
  const { getDB } = require(DATABASE_MODULE);
  const { migrateLegacyProjects } = require(LEGACY_MODULE);

  await migrateRun(opts.userData || undefined);
  const DB = getDB(opts.userData || undefined);

  const result = await migrateLegacyProjects(DB, hostVersion);
  await DB.destroy();
  console.log('宿主版本：' + hostVersion);
  console.log('迁移：' + result.migrated + ' 个，跳过：' + result.skipped + ' 个，失败：' + result.failed.length + ' 个');
  for (const item of result.failed) console.log('  失败：' + item);
  if (result.failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('迁移失败：' + (error && error.message ? error.message : String(error)));
  if (error && error.stack) console.error(error.stack);
  process.exit(1);
});
