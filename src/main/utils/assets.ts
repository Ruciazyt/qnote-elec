import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

export function getAssetsDir(): string {
  return !app.isPackaged
    ? path.join(app.getAppPath(), "..", "..", "resources")
    : path.join(process.resourcesPath, "resources");
}

export function getAssetDirs(): string[] {
  if (app.isPackaged) {
    return [getAssetsDir()];
  }

  return [
    getAssetsDir(),
    path.join(app.getAppPath(), "..", "..", "src", "renderer", "public"),
  ];
}

export function resolveAssetPath(fileName: string): string {
  return path.join(getAssetsDir(), fileName);
}

export function resolveFirstExistingAsset(filenames: string[]): string | null {
  for (const name of filenames) {
    for (const dir of getAssetDirs()) {
      const assetPath = path.join(dir, name);
      if (fs.existsSync(assetPath)) {
        return assetPath;
      }
    }
  }
  return null;
}

export function resolveExistingAssets(filenames: string[]): string[] {
  const candidates: string[] = [];

  for (const name of filenames) {
    for (const dir of getAssetDirs()) {
      const assetPath = path.join(dir, name);
      if (fs.existsSync(assetPath) && !candidates.includes(assetPath)) {
        candidates.push(assetPath);
      }
    }
  }

  return candidates;
}

const APP_ICON_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  win32: ["icon.ico", "icon.png"],
  darwin: ["icon.png", "icon-256.png", "icon-128.png"],
  linux: ["icon.png", "icon-256.png", "icon-128.png"],
};

const TRAY_ICON_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  win32: ["icon.ico", "icon-tray.png", "icon.png"],
  darwin: ["trayTemplate.png", "icon-tray.png", "icon.png", "icon-256.png"],
  linux: ["icon-tray.png", "icon.png", "icon-256.png"],
};

export function resolveAppIcon(): string | null {
  return resolveFirstExistingAsset([...(APP_ICON_CANDIDATES[process.platform] ?? [])]);
}

export function resolveTrayIcons(): string[] {
  return resolveExistingAssets([...(TRAY_ICON_CANDIDATES[process.platform] ?? [])]);
}

export function getTrayIconSize(): number {
  return process.platform === "darwin" ? 32 : 16;
}
