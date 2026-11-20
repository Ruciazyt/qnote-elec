import * as fs from "node:fs";
import { app } from "electron";
import { getAppPackageJsonPath } from "../../utils/paths";

function readDevRootVersion(): string {
  try {
    const raw = fs.readFileSync(getAppPackageJsonPath(), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
  }
  return "";
}

export function appVersion(): string {
  if (!app.isPackaged) {
    const devVersion = readDevRootVersion();
    if (devVersion) return devVersion;
  }
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}
