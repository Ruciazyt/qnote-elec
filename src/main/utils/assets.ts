/**
 * 资源与图标解析
 *
 * ## 为什么抽成公共模块
 *
 * 原来 `getAssetsDir` / `getAssetDirs` / `resolveFirstExistingAsset`
 * 这几个函数在 `index.ts`、`mainWindow.ts`、`tray.ts`、`clipboardPopup.ts`
 * 各抄了一份。改路径规则要同时改四处，漏一处就是「打包后找不到图标」这类问题。
 *
 * ## 图标为什么必须按平台挑
 *
 * Electron 的 `nativeImage` 在 **macOS / Linux 上读不了 .ico** —— 它会返回一张
 * 空图（`isEmpty()` 为 true），托盘图标直接抛「无法加载图标文件」，
 * 主窗口图标也是空的。而仓库里原本只有 `resources/icon.ico`。
 *
 * 所以按平台给不同的候选文件名：
 *
 * - Windows：`.ico` 优先（多尺寸，任务栏 / exe 图标都用它）
 * - macOS / Linux：PNG（由 `scripts/build/generate-icons.js` 从 `icon.svg` 生成）
 *
 * macOS 上 PNG 由生成脚本产出为 `resources/icon.png` 与 `resources/icon-tray.png`，
 * 打包时随 `resources/` 一起进 `process.resourcesPath/resources`。
 * 开发态还能退化到 `src/renderer/public/icon-256.png`（仓库里已有）。
 */
import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * 资源根目录
 *
 * 开发态：`app.getAppPath()` 是 `<仓库>/dist/main`（入口是 dist/main/index.js），
 * 所以往上两级才是仓库根。打包后：`process.resourcesPath/resources`。
 */
export function getAssetsDir(): string {
  return !app.isPackaged
    ? path.join(app.getAppPath(), "..", "..", "resources")
    : path.join(process.resourcesPath, "resources");
}

/**
 * 资源搜索目录（按优先级）
 *
 * 开发态除了仓库根的 resources/，还把渲染层的 public/ 算进去 ——
 * 那里有 icon-16/32/48/64/128/256.png，开发时可以直接当图标用。
 */
export function getAssetDirs(): string[] {
  if (app.isPackaged) {
    return [getAssetsDir()];
  }

  return [
    getAssetsDir(),
    path.join(app.getAppPath(), "..", "..", "src", "renderer", "public"),
  ];
}

/** 拼出资源目录下的某个文件的绝对路径（不判断是否存在） */
export function resolveAssetPath(fileName: string): string {
  return path.join(getAssetsDir(), fileName);
}

/** 按候选文件名顺序，返回第一个真实存在的文件路径 */
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

/** 按候选文件名顺序，返回所有真实存在的文件路径（同名文件出现在多个目录时只取一次） */
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

/**
 * 应用图标（窗口图标）的候选文件名，按平台
 *
 * darwin / linux 不列 .ico —— nativeImage 在这两个平台上读 .ico 得到空图，
 * 与其让它失败，不如直接换下一个候选。
 */
const APP_ICON_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  win32: ["icon.ico", "icon.png"],
  darwin: ["icon.png", "icon-256.png", "icon-128.png"],
  linux: ["icon.png", "icon-256.png", "icon-128.png"],
};

/** 托盘图标的候选文件名，按平台 */
const TRAY_ICON_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  win32: ["icon.ico", "icon-tray.png", "icon.png"],
  darwin: ["icon-tray.png", "icon.png", "icon-256.png"],
  linux: ["icon-tray.png", "icon.png", "icon-256.png"],
};

/** 解析应用图标路径；找不到返回 null */
export function resolveAppIcon(): string | null {
  return resolveFirstExistingAsset([...(APP_ICON_CANDIDATES[process.platform] ?? [])]);
}

/** 解析托盘图标的全部候选路径（按优先级） */
export function resolveTrayIcons(): string[] {
  return resolveExistingAssets([...(TRAY_ICON_CANDIDATES[process.platform] ?? [])]);
}

/**
 * 托盘图标的显示边长（像素）
 *
 * Windows 任务栏托盘是 16px。
 * macOS 菜单栏高 22pt，标准托盘图标是 16pt@2x，也就是 32px ——
 * 在 macOS 上按 16px 缩会缩得只剩一半，几乎看不清。
 */
export function getTrayIconSize(): number {
  return process.platform === "darwin" ? 32 : 16;
}
