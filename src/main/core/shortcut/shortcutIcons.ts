import { app, nativeImage } from "electron";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { log } from "../system/log";

const execFileAsync = promisify(execFile);

export type ShortcutKind = "url" | "app" | "folder";

const DATA_URL_MAX_PX = 96;

function cacheDir(): string {
  return path.join(app.getPath("userData"), "shortcut-icons");
}

const memCache = new Map<string, string | null>();
const failedAt = new Map<string, number>();
const FAILURE_TTL_MS = 60_000;

const inflight = new Map<string, Promise<string | null>>();

function cacheKey(kind: ShortcutKind, target: string): string {
  return `${kind}:${normalizeTarget(kind, target)}`;
}

function normalizeTarget(kind: ShortcutKind, target: string): string {
  if (kind !== "url") {
    const trimmed = target.trim();
    try {
      const normalized = path.normalize(trimmed);
      return normalized.length > 3 ? normalized.replace(/^((?:[\s\S]*[^\\/])?)[\\/]+$/, "$1") : normalized;
    } catch {
      return trimmed;
    }
  }
  return target.trim();
}

function cacheFile(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return path.join(cacheDir(), `${hash}.png`);
}

function toPngDataUrl(buffer: Buffer): string | null {
  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const longest = Math.max(width, height);
    const resized =
      longest > DATA_URL_MAX_PX
        ? image.resize({
            width: Math.max(1, Math.round((width / longest) * DATA_URL_MAX_PX)),
            height: Math.max(1, Math.round((height / longest) * DATA_URL_MAX_PX)),
            quality: "best",
          })
        : image;
    return resized.toDataURL();
  } catch {
    return null;
  }
}

function readDiskCache(key: string): string | null {
  try {
    const file = cacheFile(key);
    if (!fs.existsSync(file)) return null;
    return toPngDataUrl(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function writeDiskCache(key: string, dataUrl: string): void {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return;
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cacheFile(key), Buffer.from(dataUrl.slice(comma + 1), "base64"));
  } catch (err) {
    log.warn("[shortcut-icon] 写图标缓存失败:", err);
  }
}


const FETCH_TIMEOUT_MS = 3500;

async function fetchWithTimeout(url: string, accept: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: accept, "User-Agent": "QNote/1.0 (shortcut icon resolver)" },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readImage(res: Response): Promise<Buffer | null> {
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (type && !type.startsWith("image/")) return null;
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 32 ? buf : null;
  } catch {
    return null;
  }
}

function parseIconHref(html: string, base: string): string | null {
  const re = /<link[^>]+>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?([^"'>]{0,512}\bicon\b)/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!href) continue;
    try {
      return new URL(href[1], base).toString();
    } catch {
    }
  }
  return null;
}

async function fetchFavicon(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const direct = await fetchWithTimeout(`${parsed.origin}/favicon.ico`, "image/*");
  if (direct) {
    const buf = await readImage(direct);
    const dataUrl = buf ? toPngDataUrl(buf) : null;
    if (dataUrl) return dataUrl;
  }

  const page = await fetchWithTimeout(parsed.toString(), "text/html,application/xhtml+xml");
  if (!page) return null;
  let html = "";
  try {
    html = await page.text();
  } catch {
    return null;
  }
  const href = parseIconHref(html, page.url || parsed.toString());
  if (!href) return null;
  const iconRes = await fetchWithTimeout(href, "image/*");
  if (!iconRes) return null;
  const buf = await readImage(iconRes);
  return buf ? toPngDataUrl(buf) : null;
}


const ICON_SCRIPT = `$ErrorActionPreference = 'Stop'
$src = $env:QNOTE_ICON_SRC
$dst = $env:QNOTE_ICON_DST
if ([string]::IsNullOrWhiteSpace($src)) { throw 'missing src' }

# A .lnk holds the shortcut itself, not the program, so extracting from it
# directly would yield the generic "shortcut" icon. Resolve the real target first.
if ([System.IO.Path]::GetExtension($src).ToLowerInvariant() -eq '.lnk') {
    $shell = New-Object -ComObject WScript.Shell
    $target = $shell.CreateShortcut($src).TargetPath
    if (-not [string]::IsNullOrWhiteSpace($target)) { $src = $target }
}

Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($src)
if ($ico -eq $null) { throw 'no icon' }
try {
    $bmp = $ico.ToBitmap()
    try {
        $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $bmp.Dispose()
    }
} finally {
    $ico.Dispose()
}
`;

async function runIconScript(target: string, outFile: string): Promise<boolean> {
  const scriptFile = path.join(os.tmpdir(), `qnote-icon-${process.pid}-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(scriptFile, ICON_SCRIPT, "ascii");

    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile],
      {
        timeout: 20_000,
        windowsHide: true,
        env: { ...process.env, QNOTE_ICON_SRC: target, QNOTE_ICON_DST: outFile },
      }
    );

    if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) return false;
    return true;
  } catch (err) {
    log.warn("[shortcut-icon] 提取程序图标失败:", err instanceof Error ? err.message : err);
    return false;
  } finally {
    try {
      if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
    } catch {
    }
  }
}

async function extractAppIcon(target: string): Promise<string | null> {
  const normalized = normalizeTarget("app", target);
  if (!fs.existsSync(normalized)) {
    log.warn("[shortcut-icon] 目标不存在，跳过图标提取:", normalized);
    return null;
  }
  if (process.platform !== "win32") {
    log.info("[shortcut-icon] 非 Windows 平台，跳过 exe 图标提取:", normalized);
    return null;
  }

  const tmp = path.join(os.tmpdir(), `qnote-icon-${process.pid}-${Date.now()}.png`);
  try {
    const ok = await runIconScript(normalized, tmp);
    if (!ok) return null;
    return toPngDataUrl(fs.readFileSync(tmp));
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
    }
  }
}


async function resolveUncached(kind: ShortcutKind, target: string): Promise<string | null> {
  const key = cacheKey(kind, target);
  const hit = readDiskCache(key);
  if (hit) return hit;

  let result: string | null = null;
  try {
    if (kind === "url") {
      result = await fetchFavicon(normalizeTarget("url", target));
    } else if (kind === "app") {
      result = await extractAppIcon(target);
    }
  } catch (err) {
    log.warn("[shortcut-icon] 解析图标失败:", err);
    result = null;
  }

  if (result) {
    writeDiskCache(key, result);
    memCache.set(key, result);
    failedAt.delete(key);
  } else {
    failedAt.set(key, Date.now());
  }
  return result;
}

export async function resolveShortcutIcon(kind: ShortcutKind, target: string): Promise<string | null> {
  const key = cacheKey(kind, target);

  if (memCache.has(key)) return memCache.get(key) ?? null;
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < FAILURE_TTL_MS) return null;
  failedAt.delete(key);
  const disk = readDiskCache(key);
  if (disk) {
    memCache.set(key, disk);
    return disk;
  }

  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  const task = resolveUncached(kind, target).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

export async function resolveShortcutIcons(
  items: Array<{ kind: ShortcutKind; target: string }>
): Promise<Array<string | null>> {
  return Promise.all(items.map((item) => resolveShortcutIcon(item.kind, item.target)));
}

export function clearShortcutIconMemoryCache(): void {
  memCache.clear();
}
