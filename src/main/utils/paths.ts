import * as fs from "node:fs";
import * as path from "node:path";

function findUp(startDir: string, name: string, maxDepth = 8): string | null {
  let dir = startDir;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function getPreloadPath(): string {
  const found = findUp(__dirname, "preload.js");
  if (found) return found;
  const root = findUp(__dirname, "package.json");
  const base = root ? path.dirname(root) : __dirname;
  return path.join(base, "dist", "main", "preload.js");
}

export function getDevRoot(): string {
  const root = findUp(__dirname, "package.json");
  return root ? path.dirname(root) : path.resolve(__dirname, "..", "..", "..");
}

export function getAppPackageJsonPath(): string {
  return path.join(getDevRoot(), "package.json");
}

export function getCatalogCredentialsPath(): string {
  const packaged = process.resourcesPath;
  if (packaged) {
    const candidates = [
      path.join(packaged, "catalog", "credentials.json"),
      path.join(packaged, "resources", "catalog", "credentials.json"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return path.join(getDevRoot(), "resources", "catalog", "credentials.json");
}
