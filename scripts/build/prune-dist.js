const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");

const ROOTS = [
  {
    src: path.join(projectRoot, "src", "main"),
    out: path.join(projectRoot, "dist", "main"),
  },
  {
    src: path.join(projectRoot, "src", "database"),
    out: path.join(projectRoot, "dist", "database"),
  },
  {
    src: path.join(projectRoot, "src", "shared"),
    out: path.join(projectRoot, "dist", "shared"),
  },
];

const EXCLUDED = [/(^|[\\/])[^\\/]*\.test\.ts$/, /(^|[\\/])[^\\/]*\.spec\.ts$/, /-rs[\\/]/];

function isExcluded(relative) {
  return EXCLUDED.some((pattern) => pattern.test(relative));
}

function collectSources(dir, base, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(base, full);
    if (entry.isDirectory()) {
      collectSources(full, base, out);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (isExcluded(relative)) continue;
    out.add(relative.replace(/\.ts$/, ".js"));
  }
}

function collectFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    out.push(full);
  }
}

function pruneEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    pruneEmptyDirs(full);
    if (fs.readdirSync(full).length === 0) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

function main() {
  const removed = [];

  for (const root of ROOTS) {
    const expected = new Set();
    collectSources(root.src, root.src, expected);

    const files = [];
    collectFiles(root.out, files);

    for (const file of files) {
      const relative = path.relative(root.out, file);
      if (!relative.endsWith(".js") && !relative.endsWith(".js.map")) continue;
      const key = relative.replace(/\.js\.map$/, ".js");
      if (expected.has(key)) continue;
      fs.rmSync(file, { force: true });
      removed.push(path.relative(projectRoot, file));
    }

    pruneEmptyDirs(root.out);
  }

  if (removed.length) {
    console.log(
      "[prune-dist] 清掉 " +
        removed.length +
        " 个陈旧产物：" +
        removed.slice(0, 10).join(", ") +
        (removed.length > 10 ? " …" : "")
    );
  }
}

main();
