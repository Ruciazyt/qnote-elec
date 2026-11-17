'use strict';


const fs = require('node:fs');
const path = require('node:path');

const cache = new Map();

function findInDir(dir, name, exts) {
  try {
    const exact = path.join(dir, name);
    if (fs.existsSync(exact)) return exact;
  } catch {
  }
  for (const ext of exts) {
    const candidate = path.join(dir, name + ext);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
    }
  }
  return null;
}

function resolveExe(name) {
  if (path.isAbsolute(name)) return name;

  const cached = cache.get(name);
  if (cached) return cached;

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
      : [''];

  let resolved = name;
  for (const dir of dirs) {
    const found = findInDir(dir, name, exts);
    if (found) {
      resolved = found;
      break;
    }
  }

  cache.set(name, resolved);
  return resolved;
}

module.exports = { resolveExe };
